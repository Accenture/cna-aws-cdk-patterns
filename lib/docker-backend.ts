import { Construct, Duration } from "@aws-cdk/core";

import { Vpc } from "@aws-cdk/aws-ec2";
import { Cluster, AwsLogDriver, ContainerImage } from "@aws-cdk/aws-ecs";
import { IRepository } from "@aws-cdk/aws-ecr";
import { ApplicationLoadBalancedFargateService } from "@aws-cdk/aws-ecs-patterns";

interface DockerBackendProps {
  /**
   * The Name of
   */
  appName: string;
  ecrRepository: IRepository;
  dockerImageTag?: string;
  cpu?: number;
  memory?: number;
  containerPort?: number;
}

export class DockerBackend extends Construct {
  public readonly ecsCluster: Cluster;
  public readonly fargateService: ApplicationLoadBalancedFargateService;

  constructor(scope: Construct, id: string, props: DockerBackendProps) {
    super(scope, id);

    this.ecsCluster = this.createCluster(
      "ecs-cluster",
      props.appName + "-cluster"
    );

    this.fargateService = new ApplicationLoadBalancedFargateService(
      this,
      props.appName + "-service",
      {
        cluster: this.ecsCluster,
        cpu: props.cpu || 512,
        desiredCount: 2,
        serviceName: props.appName,
        taskImageOptions: {
          image: ContainerImage.fromEcrRepository(
            props.ecrRepository,
            props.dockerImageTag
          ),
          containerPort: props.containerPort || 80,
          enableLogging: true,
          logDriver: new AwsLogDriver({ streamPrefix: props.appName }),

          //executionRole: , //Cloudwatch?
          //taskRole: , // DynamoDB
        },
        memoryLimitMiB: props.memory || 1024,
        publicLoadBalancer: true,
      }
    );

    // Setup AutoScaling policy
    const scaling = this.fargateService.service.autoScaleTaskCount({
      maxCapacity: 8,
    });
    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 75,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
    });
  }

  private createCluster(id: string, clusterName: string): Cluster {
    const vpc = new Vpc(this, clusterName + "Vpc", {
      maxAzs: 3, // Default is all AZs in region
    });

    const cluster = new Cluster(this, clusterName, {
      vpc: vpc,
    });

    return cluster;
  }
}
