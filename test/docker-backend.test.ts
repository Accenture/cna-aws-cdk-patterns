import { DockerBackend } from "./../lib/docker-backend";
import {
  expect as expectCDK,
  //haveResource,
  haveResourceLike,
  //SynthUtils,
  Capture,
  notMatching,
} from "@aws-cdk/assert";

import { App, Stack } from "@aws-cdk/core";

// test('enforce region us-east-1', () => {
//   const app = new cdk.App();
//   const stack = new cdk.Stack(app, 'TestStack');
//   // WHEN
//   new StaticWebsite(stack, 'test-website', { name: 'example.com' });
//   // THEN
//   expect(stack).toThrowError();
// });

test("has basic resources that are named appropriately", () => {
  const app = new App();
  const stack = new Stack(app, "test-stack", { env: { region: "us-east-1" } });

  const testParams = {
    appName: "docker-backend",
  };

  const dockerBackend = new DockerBackend(
    stack,
    "test-docker-backend",
    testParams
  );

  expectCDK(stack).to(haveResourceLike("AWS::EC2::VPC"));

  expect(dockerBackend.ecsCluster.clusterName).toEqual(testParams.appName);

  expect(dockerBackend.loadBalancer.loadBalancerName).toEqual(
    testParams.appName
  );

  expect(dockerBackend.fargateService.serviceName).toEqual(testParams.appName);
});

describe("has resources to route HTTPS traffic to and from container with default props", () => {
  const app = new App();
  const stack = new Stack(app, "test-stack", { env: { region: "us-east-1" } });

  const testParams = {
    appName: "docker-backend",
  };

  const dockerBackend = new DockerBackend(
    stack,
    "test-docker-backend",
    testParams
  );

  const albRef = Capture.aString();
  const albSgRef = Capture.aString();
  const targetGroupRef = Capture.aString();

  test("Alb is accessable from the internet", () => {
    expectCDK(stack).to(
      haveResourceLike("AWS::ElasticLoadBalancingV2::LoadBalancer", {
        Scheme: "internet-facing",
        SecurityGroups: [
          {
            "Fn::GetAtt": [albRef.capture(), "GroupId"],
          },
        ],
        Type: "application",
      })
    );
    expectCDK(stack).to(
      haveResourceLike("AWS::EC2::SecurityGroup", {
        SecurityGroupEgress: [
          {
            CidrIp: "0.0.0.0/0",
            Description: "Allow all outbound traffic by default",
            IpProtocol: "-1",
          },
        ],
        SecurityGroupIngress: [
          {
            CidrIp: "0.0.0.0/0",
            FromPort: 443,
            IpProtocol: "tcp",
            ToPort: 443,
          },
          {
            CidrIp: "0.0.0.0/0",
            FromPort: 80,
            IpProtocol: "tcp",
            ToPort: 80,
          },
        ],
      })
    );
  });

  test("ALB redirects HTTP to HTTPs", () => {
    expect(dockerBackend.listener.http.loadBalancer.loadBalancerArn).toEqual(
      dockerBackend.loadBalancer.loadBalancerArn
    );

    expectCDK(stack).to(
      haveResourceLike("AWS::ElasticLoadBalancingV2::Listener", {
        DefaultActions: [
          {
            Type: "redirect",
            RedirectConfig: {
              Port: 443,
              Protocol: "HTTPS",
              StatusCode: "HTTP_301",
            },
            Port: 80,
            Protocol: "HTTP",
          },
        ],
        LoadBalancerArn: {
          Ref: albRef.capture(),
        },
      })
    );
  });

  test("ALB forwards HTTPs traffic to TargetGroup", () => {
    expect(dockerBackend.listener.https.loadBalancer.loadBalancerArn).toEqual(
      dockerBackend.loadBalancer.loadBalancerArn
    );

    expectCDK(stack).to(
      haveResourceLike("AWS::ElasticLoadBalancingV2::ListenerRule", {
        DefaultActions: [
          {
            Type: "forward",
            TargetGroupArn: {
              Ref: targetGroupRef.capture(),
            },
          },
        ],
        Port: 443,
        Protocol: "HTTPS",
        LoadBalancerArn: {
          Ref: albRef.capturedValue,
        },
      })
    );
  });

  test("TargetGroup is associated with correct ALB", () => {
    expect(dockerBackend.albTargetGroup.loadBalancerArns).toContain(
      dockerBackend.loadBalancer.loadBalancerArn
    );
  });

  test("Fargate Service is associated with the TargetGroup", () => {
    expectCDK(stack).to(
      haveResourceLike("AWS::ECS::Service", {
        LaunchType: "FARGATE",
        LoadBalancers: [
          {
            ContainerName: "docker-backend",
            ContainerPort: 80,
            TargetGroupArn: {
              Ref: targetGroupRef.capturedValue,
            },
          },
        ],
      })
    );

    test("Security Groups are correctly set", () => {
      expectCDK(stack).to(
        haveResourceLike("AWS::EC2::SecurityGroupIngress", {
          IpProtocol: "tcp",
          FromPort: 80,
          GroupId: {
            "Fn::GetAtt": [notMatching(albSgRef.capturedValue), "GroupId"],
          },
          SourceSecurityGroupId: {
            "Fn::GetAtt": [albSgRef.capturedValue, "GroupId"],
          },
          ToPort: 80,
        })
      );
    });
  });

  /**
   * (Route53 --> ) ALB --> Listener --> TagetGroup --> Target --> Fargate Service --> Task definition
   * The problem is that cloudformation works with Refs who's names are random, so we can't test that
   * I'm trying to use cdk properties to do the assertions but I haven't found all yet.
   */

  /*
  other checks:
  expect(dockerBackend.securityGroup.allowAllOutbound).toBeTruthy();

  expect(dockerBackend.loadBalancer.loadBalancerSecurityGroups[0]).toEqual(
    dockerBackend.securityGroup.securityGroupId
  );

  expect(dockerBackend.taskDefinition.isFargateCompatible).toBeTruthy();

  expect(dockerBackend.fargateService.cluster.clusterArn).toEqual(
    dockerBackend.ecsCluster.clusterArn
  );
  expect(dockerBackend.fargateService.taskDefinition.taskDefinitionArn).toEqual(
    dockerBackend.taskDefinition.taskDefinitionArn
  );
  expect(dockerBackend.fargateService.connections.securityGroups[0]).toEqual(
    dockerBackend.securityGroup.securityGroupId
  );

  expectCDK(stack).to(
    haveResourceLike("AWS::ElasticLoadBalancingV2::Listener", {
      Port: 443,
      Protocol: "HTTPS",
    })
  );*/
});
