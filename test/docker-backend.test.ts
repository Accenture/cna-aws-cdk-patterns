import { ContainerImage } from "@aws-cdk/aws-ecs";
import { DockerBackend } from "./../lib/docker-backend";
import {
  expect as expectCDK,
  haveResourceLike,
  countResources,
  Capture,
  notMatching,
  haveResource,
  objectLike,
  stringLike,
  arrayWith,
} from "@aws-cdk/assert";

import { Stack } from "@aws-cdk/core";
import { HostedZone } from "@aws-cdk/aws-route53";

// test('enforce region us-east-1', () => {
//   const app = new cdk.App();
//   const stack = new cdk.Stack(app, 'TestStack');
//   // WHEN
//   new StaticWebsite(stack, 'test-website', { name: 'example.com' });
//   // THEN
//   expect(stack).toThrowError();
// });

describe("has all nessecary resources", () => {
  const stack = new Stack();

  const testParams = {
    appName: "docker-backend",
    certificateArn:
      "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
  };

  new DockerBackend(stack, "test-docker-backend", testParams);

  runTestsToValidateBasicResources(stack);
});

describe("Test minimal parameters with certificateArn", () => {
  const stack = new Stack();

  const testParams = {
    appName: "docker-backend",
    certificateArn:
      "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
  };

  const dockerBackend = new DockerBackend(
    stack,
    "test-docker-backend",
    testParams
  );

  runTestsToValidateBasicResources(stack);
  runTestsToValidateTrafficFlow(stack, dockerBackend, 80);
});

describe("Test minimal parameters with domainName and hostedZone", () => {
  const stack = new Stack();

  const testParams = {
    appName: "docker-backend",
    domainName: "api",
    hostedZone: new HostedZone(stack, "zone", {
      zoneName: "docker-backend.io",
    }),
  };

  const dockerBackend = new DockerBackend(
    stack,
    "test-docker-backend",
    testParams
  );

  runTestsToValidateBasicResources(stack);

  test("has route53 records", () => {
    expectCDK(stack).to(haveResource("AWS::Route53::HostedZone"));
    expectCDK(stack).to(
      haveResourceLike("AWS::Route53::RecordSet", {
        Name:
          testParams.domainName + "." + testParams.hostedZone.zoneName + ".",
        Type: "A",
      })
    );
  });

  runTestsToValidateTrafficFlow(stack, dockerBackend, 80);
});

describe("Test maximal parameters with domainName and hostedZone", () => {
  const stack = new Stack();

  const imageName = "httpd";

  const testParams = {
    appName: "docker-backend",
    domainName: "api",
    hostedZone: new HostedZone(stack, "zone", {
      zoneName: "docker-backend.io",
    }),
    cpu: 1024,
    memory: 2048,
    containerPort: 8080,
    healthCheckPath: "/healthcheck.html",
    initialContainerImage: ContainerImage.fromRegistry(imageName),
  };

  const dockerBackend = new DockerBackend(
    stack,
    "test-docker-backend",
    testParams
  );

  runTestsToValidateBasicResources(stack);

  test("has route53 records", () => {
    expectCDK(stack).to(haveResource("AWS::Route53::HostedZone"));
    expectCDK(stack).to(
      haveResourceLike("AWS::Route53::RecordSet", {
        Name:
          testParams.domainName + "." + testParams.hostedZone.zoneName + ".",
        Type: "A",
      })
    );
  });

  test("has correct container values for cpu, memory, port and image values", () => {
    expectCDK(stack).to(
      haveResourceLike("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: [
          {
            Image: imageName,
            PortMappings: [
              {
                ContainerPort: testParams.containerPort,
                Protocol: "tcp",
              },
            ],
          },
        ],
        Cpu: testParams.cpu.toString(),
        Memory: testParams.memory.toString(),
      })
    );
  });

  test("has correct healthcheck path and port", () => {
    expectCDK(stack).to(
      haveResourceLike("AWS::ElasticLoadBalancingV2::TargetGroup", {
        HealthCheckEnabled: true,
        HealthCheckPath: testParams.healthCheckPath,
        Port: testParams.containerPort,
        Protocol: "HTTP",
        TargetType: "ip",
      })
    );
  });

  runTestsToValidateTrafficFlow(stack, dockerBackend, testParams.containerPort);
});

describe("Test extensions for IAM policies", () => {
  const stack = new Stack();

  const imageName = "httpd";

  const testParams = {
    appName: "docker-backend",
    domainName: "api",
    hostedZone: new HostedZone(stack, "zone", {
      zoneName: "docker-backend.io",
    }),
    cpu: 1024,
    memory: 2048,
    containerPort: 8080,
    healthCheckPath: "/healthcheck.html",
    initialContainerImage: ContainerImage.fromRegistry(imageName),
  };

  const dockerBackend = new DockerBackend(
    stack,
    "test-docker-backend",
    testParams
  );

  test("No DynamoDB access before enabling it", () => {
    checkIfStackDoesNotHavePolicy(stack, "dynamodb:*");
  });

  test("DynamoDb access after enabling it", () => {
    dockerBackend.enableDynamoDBAccess();
    checkIfStackHasPolicy(stack, "dynamodb:*");
  });

  test("No S3 access before enabling it", () => {
    checkIfStackDoesNotHavePolicy(stack, "s3:*");
  });

  test("S3 access after enabling it", () => {
    dockerBackend.enableS3Access();
    checkIfStackHasPolicy(stack, "s3:*");
  });

  test("No SQS access before enabling it", () => {
    checkIfStackDoesNotHavePolicy(stack, "sqs:*");
  });

  test("SQS access after enabling it", () => {
    dockerBackend.enableSQSAccess();
    checkIfStackHasPolicy(stack, "sqs:*");
  });

  test("No SNS access before enabling it", () => {
    checkIfStackDoesNotHavePolicy(stack, "sns:*");
  });

  test("SNS access after enabling it", () => {
    dockerBackend.enableSNSAccess();
    checkIfStackHasPolicy(stack, "sns:*");
  });

  runTestsToValidateBasicResources(stack);

  runTestsToValidateTrafficFlow(stack, dockerBackend, testParams.containerPort);
});

test("Test with wrong parameters", () => {
  const stack = new Stack();

  expect(
    () =>
      new DockerBackend(stack, "test-docker-backend", {
        appName: "docker-backend",
      })
  ).toThrowError();

  expect(
    () =>
      new DockerBackend(stack, "test-docker-backend", {
        appName: "docker-backend",
        domainName: "api",
      })
  ).toThrowError();

  expect(
    () =>
      new DockerBackend(stack, "test-docker-backend", {
        appName: "docker-backend",
        hostedZone: new HostedZone(stack, "zone", {
          zoneName: "docker-backend.io",
        }),
      })
  ).toThrowError();
});

function runTestsToValidateBasicResources(stack: Stack): void {
  it("has all nessecary resources", () => {
    expectCDK(stack).to(countResources("AWS::EC2::VPC", 1));
    expectCDK(stack).to(haveResource("AWS::EC2::Subnet"));
    expectCDK(stack).to(haveResource("AWS::EC2::RouteTable"));
    expectCDK(stack).to(haveResource("AWS::EC2::SubnetRouteTableAssociation"));
    expectCDK(stack).to(haveResource("AWS::EC2::Route"));
    expectCDK(stack).to(haveResource("AWS::EC2::NatGateway"));
    expectCDK(stack).to(haveResource("AWS::EC2::InternetGateway"));
    expectCDK(stack).to(haveResource("AWS::EC2::VPCGatewayAttachment"));
    expectCDK(stack).to(countResources("AWS::ECS::Cluster", 1));
    expectCDK(stack).to(haveResource("AWS::EC2::SecurityGroup"));
    expectCDK(stack).to(
      countResources("AWS::ElasticLoadBalancingV2::LoadBalancer", 1)
    );
    expectCDK(stack).to(haveResource("AWS::ElasticLoadBalancingV2::Listener"));
    expectCDK(stack).to(
      countResources("AWS::ElasticLoadBalancingV2::TargetGroup", 1)
    );
    expectCDK(stack).to(haveResource("AWS::IAM::Role"));
    expectCDK(stack).to(countResources("AWS::ECS::TaskDefinition", 1));
    expectCDK(stack).to(
      haveResource("AWS::ApplicationAutoScaling::ScalableTarget")
    );
    expectCDK(stack).to(countResources("AWS::ECS::Service", 1));
  });
}

function runTestsToValidateTrafficFlow(
  stack: Stack,
  dockerBackend: DockerBackend,
  containerPort: number
): void {
  const albRef = Capture.aString();
  const albSgRef = Capture.aString();
  const targetGroupRef = Capture.aString();

  test("Alb is accessable from the internet", () => {
    expectCDK(stack).to(
      haveResourceLike("AWS::ElasticLoadBalancingV2::LoadBalancer", {
        Scheme: "internet-facing",
        SecurityGroups: [
          objectLike({
            "Fn::GetAtt": [albSgRef.capture(), "GroupId"],
          }),
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
              Port: "443",
              Protocol: "HTTPS",
              StatusCode: "HTTP_301",
            },
          },
        ],
        LoadBalancerArn: objectLike({
          Ref: albRef.capture(),
        }),
        Port: 80,
        Protocol: "HTTP",
      })
    );
  });

  test("ALB forwards HTTPs traffic to TargetGroup", () => {
    expect(dockerBackend.listener.https.loadBalancer.loadBalancerArn).toEqual(
      dockerBackend.loadBalancer.loadBalancerArn
    );

    expectCDK(stack).to(
      haveResourceLike("AWS::ElasticLoadBalancingV2::Listener", {
        DefaultActions: [
          objectLike({
            Type: "forward",
            TargetGroupArn: {
              Ref: targetGroupRef.capture(),
            },
          }),
        ],
        Port: 443,
        Protocol: "HTTPS",
        LoadBalancerArn: objectLike({
          Ref: albRef.capturedValue,
        }),
      })
    );
  });

  test("Fargate Service is associated with the TargetGroup", () => {
    expectCDK(stack).to(
      haveResourceLike("AWS::ECS::Service", {
        LaunchType: "FARGATE",
        LoadBalancers: [
          {
            ContainerName: "docker-backend",
            ContainerPort: containerPort,
            TargetGroupArn: objectLike({
              Ref: targetGroupRef.capturedValue,
            }),
          },
        ],
      })
    );
  });

  test("Security Groups are correctly set", () => {
    expectCDK(stack).to(
      haveResourceLike("AWS::EC2::SecurityGroupIngress", {
        IpProtocol: "tcp",
        FromPort: containerPort,
        GroupId: objectLike({
          "Fn::GetAtt": [notMatching(albSgRef.capturedValue), "GroupId"],
        }),
        SourceSecurityGroupId: {
          "Fn::GetAtt": [albSgRef.capturedValue, "GroupId"],
        },
        ToPort: containerPort,
      })
    );
  });
}

function checkIfStackHasPolicy(stack: Stack, action: string): boolean {
  expectCDK(stack).to(
    haveResourceLike("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: arrayWith(
          objectLike({
            Action: action,
            Effect: "Allow",
            Resource: "*",
          })
        ),
      },
    })
  );

  return true;
}

function checkIfStackDoesNotHavePolicy(stack: Stack, action: string): boolean {
  expectCDK(stack).to(
    haveResourceLike("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: arrayWith(
          objectLike({
            Action: notMatching(stringLike(action)),
            Effect: "Allow",
            Resource: "*",
          })
        ),
      },
    })
  );

  return true;
}
