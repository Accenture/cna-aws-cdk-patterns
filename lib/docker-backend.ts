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
  IEcsLoadBalancerTarget,
} from "@aws-cdk/aws-ecs";
import {
  ApplicationLoadBalancer,
  ApplicationTargetGroup,
  ApplicationProtocol,
  ApplicationListener,
  SslPolicy,
} from "@aws-cdk/aws-elasticloadbalancingv2";
import {
  RecordSet,
  RecordType,
  RecordTarget,
  IHostedZone,
} from "@aws-cdk/aws-route53";
import {
  Certificate,
  CertificateValidation,
} from "@aws-cdk/aws-certificatemanager";
import { Effect, PolicyStatement } from "@aws-cdk/aws-iam";
import { LoadBalancerTarget } from "@aws-cdk/aws-route53-targets";

interface DockerBackendProps {
  /**
   * The Name of the application
   */
  appName: string;
  /**
   * The domain name for the Docker Backend API. It must be matching the Hosted Zone.
   * This construct will create a new
   */
  domainName?: string;
  /**
   * The Route 53 Hosted Zone to which the DNS record for the backend should be added.
   * Additionally, this Hosted Zone will be used for validating the accompanied SSL certificate.
   */
  hostedZone?: IHostedZone;
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
  public listener: ApplicationListener;
  public securityGroup: SecurityGroup;
  public taskDefinition: TaskDefinition;
  public fargateService: FargateService;
  public albTargetGroup: ApplicationTargetGroup;
  public albTarget: IEcsLoadBalancerTarget;

  private DEFAULT_PORT_PROD: number = 80;

  constructor(scope: Construct, id: string, props: DockerBackendProps) {
    super(scope, id);

    const vpc = new Vpc(this, props.appName, {
      maxAzs: 3, // Default is all AZs in region
    });

    this.ecsCluster = new Cluster(this, props.appName, {
      vpc: vpc,
      clusterName: props.appName,
    });

    this.loadBalancer = new ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc,
      internetFacing: true,
      loadBalancerName: props.appName,
    });

    this.loadBalancer.addRedirect({
      sourceProtocol: ApplicationProtocol.HTTP,
      sourcePort: 80,
      targetProtocol: ApplicationProtocol.HTTPS,
      targetPort: 443,
    });

    /**
     * if domain name and hosted zone are provided,
     * we will create a custom ssl certificate and
     * a route 53 record to forward requests to the alb
     */
    if (props.domainName && props.hostedZone) {
      const certificate = new Certificate(this, "certificate", {
        domainName: props.domainName,
        validation: CertificateValidation.fromDns(props.hostedZone),
      });

      this.listener = this.loadBalancer.addListener("listener", {
        port: 443, // Exposing via HTTPs only
        protocol: ApplicationProtocol.HTTPS,
        certificates: [certificate],
        sslPolicy: SslPolicy.RECOMMENDED,
      });

      // Create the DNS record in the Hosted Zone
      new RecordSet(this, "cloudfront-alias-record", {
        zone: props.hostedZone,
        recordName: props.domainName,
        recordType: RecordType.A,
        target: RecordTarget.fromAlias(
          new LoadBalancerTarget(this.loadBalancer)
        ),
      });
    } else {
      // Add listener with default cert and no custom domain
      this.listener = this.loadBalancer.addListener("listener", {
        port: 443, // Exposing via HTTPs only
        protocol: ApplicationProtocol.HTTPS,
        sslPolicy: SslPolicy.RECOMMENDED,
      });
    }

    /**
     * We need to have 2 Security Groups here
     * 1. Security Group to Allow HTTPS traffic to the ALB
     * 2. To allow HTTP Traffic + container port from ALB to Container
     */
    this.securityGroup = new SecurityGroup(this, "FargateSecurityGroup", {
      securityGroupName: props.appName,
      vpc: vpc,
      allowAllOutbound: true,
    });

    this.securityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(props.containerPort || this.DEFAULT_PORT_PROD)
    );

    this.loadBalancer.addSecurityGroup(this.securityGroup);

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

    this.fargateService = new FargateService(this, "FargateService", {
      cluster: this.ecsCluster,
      taskDefinition: this.taskDefinition,
      securityGroup: this.securityGroup,
      platformVersion: FargatePlatformVersion.VERSION1_4,
      propagateTags: PropagatedTagSource.SERVICE,
      serviceName: props.appName,
    });

    this.fargateService.connections.allowFrom(
      this.loadBalancer,
      Port.tcp(props.containerPort || this.DEFAULT_PORT_PROD)
    );

    this.albTarget = this.fargateService.loadBalancerTarget({
      containerName: props.appName,
      containerPort: props.containerPort || this.DEFAULT_PORT_PROD,
    });

    this.albTargetGroup = this.listener.addTargets(props.appName, {
      targetGroupName: props.appName,
      port: props.containerPort || this.DEFAULT_PORT_PROD,
      targets: [this.albTarget],
      healthCheck: {
        enabled: true,
        path: props.healthCheckPath || "/",
      },
    });

    /*this.fargateService.registerLoadBalancerTargets({
      containerName: props.appName,
      containerPort: props.containerPort || this.DEFAULT_PORT_PROD,
      newTargetGroupId: props.appName,
      listener: ListenerConfig.applicationListener(this.listener, {
        protocol: ApplicationProtocol.HTTPS,
        healthCheck: {
          enabled: true,
          path: props.healthCheckPath || "/",
        },
      }),
    });*/
  }
}
