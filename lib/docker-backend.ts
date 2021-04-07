import { Construct } from "@aws-cdk/core";

import {
  Vpc,
  Port,
  SecurityGroup,
  Peer,
  ISecurityGroup,
} from "@aws-cdk/aws-ec2";
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
  ContainerDefinition,
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

export interface DockerBackendProps {
  /**
   * The Name of the application
   */
  appName: string;
  /**
   * !!! You must either provide a domainName with a hostedZone or the acmCertificateArn !!!
   *
   * The domain name for the Docker Backend API. It must be matching the Hosted Zone.
   * This construct will create a new
   */
  domainName?: string;
  /**
   * !!! You must either provide a domainName with a hostedZone or the acmCertificateArn !!!
   *
   * The Route 53 Hosted Zone to which the DNS record for the backend should be added.
   * Additionally, this Hosted Zone will be used for validating the accompanied SSL certificate.
   */
  hostedZone?: IHostedZone;
  /**
   * !!! You must either provide a domainName with a hostedZone or the acmCertificateArn !!!
   *
   * The ARN of an exsisting SSL Certificate in AWS ACM
   */
  acmCertificateArn?: string;
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

interface DockerBackendTask {
  taskDefinition: TaskDefinition;
  containerDefinition: ContainerDefinition;
}

interface DockerBackendListener {
  http: ApplicationListener;
  https: ApplicationListener;
}

export class DockerBackend extends Construct {
  public ecsCluster: Cluster;
  public loadBalancer: ApplicationLoadBalancer;
  public listener: DockerBackendListener;
  public taskDefinition: TaskDefinition;
  public fargateService: FargateService;
  public albTargetGroup: ApplicationTargetGroup;
  public albTarget: IEcsLoadBalancerTarget;

  private DEFAULT_PORT_PROD: number = 80;

  constructor(scope: Construct, id: string, props: DockerBackendProps) {
    super(scope, id);

    const containerPort = props.containerPort || this.DEFAULT_PORT_PROD;

    const vpc = new Vpc(this, "vpc", {
      maxAzs: 3, // Default is all AZs in region, but we wouldn't want 5 AZs to eat up our ip-range just to manage subnets
    });

    this.ecsCluster = new Cluster(this, "ecs-cluster", {
      vpc: vpc,
      clusterName: props.appName,
    });

    this.loadBalancer = this.configureAlb(vpc, props.appName);

    this.listener = this.configureAlbListener(
      this.loadBalancer,
      props.domainName,
      props.hostedZone,
      props.acmCertificateArn
    );

    const {
      taskDefinition,
      containerDefinition,
    } = this.configureEcsTaskDefinition(props, containerPort);
    this.taskDefinition = taskDefinition;

    this.fargateService = new FargateService(this, "fargate-service", {
      cluster: this.ecsCluster,
      taskDefinition: this.taskDefinition,
      securityGroup: this.configureSecurityGroupForFargateService(
        vpc,
        this.loadBalancer.connections.securityGroups[0], // this is safer than referencing a SG itself because even if the wrong SG is assigned to the ALB fargate will still accept connections from the ALB only
        props.containerPort || this.DEFAULT_PORT_PROD
      ),
      platformVersion: FargatePlatformVersion.VERSION1_4,
      propagateTags: PropagatedTagSource.SERVICE,
      serviceName: props.appName,
    });

    /**
     * Hook up Fargate to Application Loadbalancer (ALB):
     * ALB --> ALB-Listener --> TargetGroup --> FargateTargets
     */

    this.albTarget = this.fargateService.loadBalancerTarget({
      containerName: containerDefinition.containerName,
      containerPort: containerDefinition.containerPort,
    });

    this.albTargetGroup = this.listener.https.addTargets("fargate-target", {
      targetGroupName: props.appName,
      port: containerPort,
      targets: [this.albTarget],
      healthCheck: {
        enabled: true,
        path: props.healthCheckPath || "/",
      },
    });

    /*
     * This is a more abstract way to hook up Fargate to Alb, however
     * for testing I was hoping to expose the Target and TargetGroup
     * Leaving this here if I find a better way to test
     *
    this.fargateService.registerLoadBalancerTargets({
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

  configureAlb(vpc: Vpc, appName: string): ApplicationLoadBalancer {
    const albSecurityGroup = new SecurityGroup(this, "alb-sg", {
      vpc: vpc,
      allowAllOutbound: true,
    });

    albSecurityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(443));

    const loadBalancer = new ApplicationLoadBalancer(this, "loadbalancer", {
      vpc,
      internetFacing: true,
      loadBalancerName: appName,
      securityGroup: albSecurityGroup,
    });

    return loadBalancer;
  }

  configureAlbListener(
    loadBalancer: ApplicationLoadBalancer,
    domainName?: string,
    hostedZone?: IHostedZone,
    certificateArn?: string
  ): DockerBackendListener {
    /**
     * if domain name and hosted zone are provided,
     * we will create a custom ssl certificate and
     * a route 53 record to forward requests to the alb
     */
    const httpListener = loadBalancer.addRedirect({
      sourceProtocol: ApplicationProtocol.HTTP,
      sourcePort: 80,
      targetProtocol: ApplicationProtocol.HTTPS,
      targetPort: 443,
    });

    let httpsListener: ApplicationListener;
    if (domainName && hostedZone) {
      const certificate = new Certificate(this, "certificate", {
        domainName: domainName,
        validation: CertificateValidation.fromDns(hostedZone),
      });

      httpsListener = loadBalancer.addListener("listener", {
        port: 443, // Exposing via HTTPs only
        protocol: ApplicationProtocol.HTTPS,
        certificates: [certificate],
        sslPolicy: SslPolicy.RECOMMENDED,
      });

      // Create the DNS record in the Hosted Zone
      new RecordSet(this, "cloudfront-alias-record", {
        zone: hostedZone,
        recordName: domainName,
        recordType: RecordType.A,
        target: RecordTarget.fromAlias(
          new LoadBalancerTarget(this.loadBalancer)
        ),
      });
    } else if (certificateArn) {
      // Add listener with existing cert and no dns record
      httpsListener = loadBalancer.addListener("listener", {
        port: 443, // Exposing via HTTPs only
        protocol: ApplicationProtocol.HTTPS,
        certificates: [
          Certificate.fromCertificateArn(
            this,
            "existing certificate",
            certificateArn
          ),
        ],
        sslPolicy: SslPolicy.RECOMMENDED,
      });
    } else {
      throw "parameters dnsName + hostedZone or certificateArn are missing";
    }

    return {
      http: httpListener,
      https: httpsListener,
    };
  }

  configureEcsTaskDefinition(
    props: DockerBackendProps,
    containerPort: number
  ): DockerBackendTask {
    // Will be replaced by CodeDeploy in CodePipeline
    const taskDefinition = new TaskDefinition(this, "initial-task-definition", {
      networkMode: NetworkMode.AWS_VPC,
      compatibility: Compatibility.FARGATE,
      cpu: props.cpu || "512",
      memoryMiB: props.memory || "1024",
      family: "blue-green",
    });

    // for ECR and CWL
    taskDefinition.addToExecutionRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: ["*"],
        actions: ["ecr:*", "logs:CreateLogStream", "logs:PutLogEvents"],
      })
    );

    if (props.enableDynamoDbAccess) {
      taskDefinition.addToTaskRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          resources: ["*"],
          actions: ["dynamodb:*"],
        })
      );
    }

    const containerDefinition = taskDefinition.addContainer(props.appName, {
      image:
        props.initialContainerImage || ContainerImage.fromRegistry("nginx"),
    });

    containerDefinition.addPortMappings({ containerPort: containerPort });

    return {
      taskDefinition,
      containerDefinition,
    };
  }

  configureSecurityGroupForFargateService(
    vpc: Vpc,
    loadbalancerSG: ISecurityGroup,
    ingressPort: number
  ): SecurityGroup {
    const fargateSecurityGroup = new SecurityGroup(this, "fargate-sg", {
      vpc: vpc,
      allowAllOutbound: true,
    });

    fargateSecurityGroup.addIngressRule(loadbalancerSG, Port.tcp(ingressPort));

    // we need to make sure that the ALB is allowed to perform a http healthcheck
    if (ingressPort !== 80) {
      fargateSecurityGroup.addIngressRule(loadbalancerSG, Port.tcp(80));
    }

    return fargateSecurityGroup;
  }
}
