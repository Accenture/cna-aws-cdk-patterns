import { Construct } from "@aws-cdk/core";

import { Vpc, Port, SecurityGroup, Peer } from "@aws-cdk/aws-ec2";
import {
  Cluster,
  ContainerImage,
  TaskDefinition,
  FargateService,
  FargatePlatformVersion,
  PropagatedTagSource,
  NetworkMode,
  Compatibility,
  ListenerConfig,
} from "@aws-cdk/aws-ecs";
import {
  ApplicationLoadBalancer,
  ApplicationTargetGroup,
  TargetType,
  ApplicationProtocol,
} from "@aws-cdk/aws-elasticloadbalancingv2";
import { Effect, PolicyStatement } from "@aws-cdk/aws-iam";

interface DockerBackendProps {
  /**
   * The Name of the application
   */
  appName: string;
  /**
   * The number of CPU Units for the fargate task.
   * The default value is 512 = 0.5 vCPU
   */
  cpu?: string;
  /**
   * The memory for the fargate task in MB
   * The default value is 1024
   */
  memory?: string;
  /**
   * We're going to use blue/green deployments in the pipeline to update the image
   * If you want to, you can define an initial image to work with
   * The default image would be a nginx image from dockerhub
   */
  initialContainerImage?: ContainerImage;
  /**
   * The port that the container exposes
   * The default value is 80
   */
  containerPort?: number;
  /**
   * The path that the loadbalancer uses to check if the container is healthy
   * The default value is /
   * Please remember that healthchecks are performed via HTTP!!!
   */
  healthCheckPath?: string;
  /**
   * If the container wants to talk to DynamoDB you need to enable this to assign the necessary policy to the Task Execution Role
   */
  enableDynamoDbAccess?: boolean;
}

/**
 * This should deploy the basic components needed for the pipeline. Including the initial task definition and service
 * We could consider adding an optional repository here and adding the repository as an input to the pipeline
 *
 * TODO: Certificates for ALB. Fargate Scaling
 */

export class DockerBackend extends Construct {
  public readonly ecsCluster: Cluster;
  public loadBalancer: ApplicationLoadBalancer;
  public taskDefinition: TaskDefinition;
  public fargateService: FargateService;

  private DEFAULT_PORT_PROD: number = 80;

  constructor(scope: Construct, id: string, props: DockerBackendProps) {
    super(scope, id);

    const vpc = new Vpc(this, props.appName, {
      maxAzs: 3, // Default is all AZs in region
    });

    this.ecsCluster = new Cluster(this, props.appName, {
      vpc: vpc,
    });

    this.loadBalancer = new ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc,
      internetFacing: true,
    });

    // Will be replaced by CodeDeploy in CodePipeline
    this.taskDefinition = new TaskDefinition(this, "InitialTaskDefinition", {
      networkMode: NetworkMode.AWS_VPC,
      compatibility: Compatibility.FARGATE,
      cpu: props.cpu || "512",
      memoryMiB: props.memory || "1024",
      family: "blue-green",
    });

    // for ECR and CWL
    this.taskDefinition.addToExecutionRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: ["*"],
        actions: ["ecr:*", "logs:CreateLogStream", "logs:PutLogEvents"],
      })
    );

    if (props.enableDynamoDbAccess) {
      this.taskDefinition.addToTaskRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          resources: ["*"],
          actions: ["dynamodb:*"],
        })
      );
    }

    this.taskDefinition.addContainer(props.appName, {
      image:
        props.initialContainerImage || ContainerImage.fromRegistry("nginx"),
    });

    const securityGroup = new SecurityGroup(this, "FargateSecurityGroup", {
      securityGroupName: props.appName,
      vpc: vpc,
      allowAllOutbound: true,
    });

    securityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(props.containerPort || this.DEFAULT_PORT_PROD)
    );

    this.fargateService = new FargateService(this, "FargateService", {
      cluster: this.ecsCluster,
      taskDefinition: this.taskDefinition,
      securityGroup,
      platformVersion: FargatePlatformVersion.VERSION1_4,
      propagateTags: PropagatedTagSource.SERVICE,
    });

    this.fargateService.connections.allowFrom(
      this.loadBalancer,
      Port.tcp(props.containerPort || this.DEFAULT_PORT_PROD)
    );

    const listener = this.loadBalancer.addListener("listener", {
      port: props.containerPort || this.DEFAULT_PORT_PROD,
    });

    const TARGET_GROUP_NAME = "targetGroup";

    const targetGroup = new ApplicationTargetGroup(this, TARGET_GROUP_NAME, {
      port: props.containerPort || this.DEFAULT_PORT_PROD,
      targetType: TargetType.IP,
      vpc,
    });

    listener.addTargetGroups("AddtargetGroup", {
      targetGroups: [targetGroup],
    });

    this.fargateService.registerLoadBalancerTargets({
      containerName: props.appName,
      containerPort: props.containerPort || this.DEFAULT_PORT_PROD,
      newTargetGroupId: TARGET_GROUP_NAME,
      listener: ListenerConfig.applicationListener(listener, {
        protocol: ApplicationProtocol.HTTPS,
        healthCheck: {
          enabled: true,
          path: props.healthCheckPath || "/",
        },
      }),
    });
  }
}
