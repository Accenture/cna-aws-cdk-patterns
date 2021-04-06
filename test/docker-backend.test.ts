import { DockerBackend } from "./../lib/docker-backend";
import {
  expect as expectCDK,
  //haveResource,
  haveResourceLike,
  //SynthUtils,
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

  expect(dockerBackend.securityGroup.securityGroupName).toEqual(
    testParams.appName
  );

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

  test("ALB redirects HTTP to HTTPs", () => {
    expectCDK(stack).to(
      haveResourceLike("AWS::ElasticLoadBalancingV2::ListenerRule", {
        Actions: [
          {
            Type: "redirect",
            RedirectConfig: {
              Host: "#{host}",
              Path: "/#{path}",
              Port: 443,
              Protocol: "HTTPS",
              Query: "#{query}",
            },
            Port: 80,
            Protocol: "HTTP",
          },
        ],
      })
    );
  });

  test("ALB forwards HTTPs traffic", () => {
    expectCDK(stack).to(
      haveResourceLike("AWS::ElasticLoadBalancingV2::ListenerRule", {
        Actions: [
          {
            Type: "forward",
            Port: 443,
            Protocol: "HTTPS",
          },
        ],
      })
    );
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
