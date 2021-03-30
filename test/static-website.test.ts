import {
  expect as expectCDK,
  haveResource,
  haveResourceLike,
  //SynthUtils,
} from "@aws-cdk/assert";
import { StaticWebsite, StaticWebsiteType } from "../lib/static-website";
import { PublicHostedZone } from "@aws-cdk/aws-route53";
import { App, Stack } from "@aws-cdk/core";

// test('enforce region us-east-1', () => {
//   const app = new cdk.App();
//   const stack = new cdk.Stack(app, 'TestStack');
//   // WHEN
//   new StaticWebsite(stack, 'test-website', { name: 'example.com' });
//   // THEN
//   expect(stack).toThrowError();
// });

test("has S3 buckets and CloudFront distribution", () => {
  const app = new App();
  const stack = new Stack(app, "test-stack", { env: { region: "us-east-1" } });
  // WHEN
  new StaticWebsite(stack, "test-website", {
    name: "example.com",
    type: StaticWebsiteType.SIMPLE,
  });
  // THEN
  expectCDK(stack).to(
    haveResource("AWS::S3::Bucket", {
      BucketName: "site-example.com-content",
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: "AES256",
            },
          },
        ],
      },
    })
  );

  expectCDK(stack).to(
    haveResource("AWS::S3::Bucket", {
      BucketName: "site-example.com-logs",
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: "AES256",
            },
          },
        ],
      },
    })
  );

  expectCDK(stack).to(
    haveResourceLike("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        DefaultCacheBehavior: {
          Compress: true,
          ViewerProtocolPolicy: "redirect-to-https",
        },
        DefaultRootObject: "index.html",
        HttpVersion: "http2",
      },
    })
  );

  // In addition to the fine granular assertions snapshot tests are performed, too
  // expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
});

test("has ACM certificate and Route 53 record set", () => {
  const app = new App();
  const stack = new Stack(app, "TestStack", { env: { region: "us-east-1" } });
  // WHEN
  new StaticWebsite(stack, "test-website", {
    name: "example.com",
    type: StaticWebsiteType.SIMPLE,
    hostedZone: new PublicHostedZone(stack, "hosted-zone", {
      zoneName: "example.com",
    }),
    domainName: "example.com",
  });
  // THEN
  expectCDK(stack).to(
    haveResource("AWS::S3::Bucket", {
      BucketName: "site-example.com-content",
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: "AES256",
            },
          },
        ],
      },
    })
  );

  expectCDK(stack).to(
    haveResource("AWS::S3::Bucket", {
      BucketName: "site-example.com-logs",
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: "AES256",
            },
          },
        ],
      },
    })
  );

  expectCDK(stack).to(
    haveResourceLike("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        DefaultCacheBehavior: {
          Compress: true,
          ViewerProtocolPolicy: "redirect-to-https",
        },
        DefaultRootObject: "index.html",
        HttpVersion: "http2",
        Aliases: ["example.com"],
      },
    })
  );

  expectCDK(stack).to(
    haveResource("AWS::CertificateManager::Certificate", {
      DomainName: "example.com",
      ValidationMethod: "DNS",
    })
  );

  expectCDK(stack).to(
    haveResource("AWS::Route53::RecordSet", {
      Name: "example.com.",
      Type: "A",
    })
  );

  // In addition to the fine granular assertions snapshot tests are performed, too
  // expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
});

test("has no custom error responses for SIMPLE", () => {
  const app = new App();
  const stack = new Stack(app, "TestStack", { env: { region: "us-east-1" } });
  // WHEN
  new StaticWebsite(stack, "test-website", {
    name: "example.com",
    type: StaticWebsiteType.SIMPLE,
  });
  // THEN

  expectCDK(stack).to(
    haveResourceLike("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        DefaultCacheBehavior: {
          Compress: true,
          ViewerProtocolPolicy: "redirect-to-https",
        },
        DefaultRootObject: "index.html",
        HttpVersion: "http2",
      },
    })
  );

  // In addition to the fine granular assertions snapshot tests are performed, too
  // expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
});

test("has custom error responses for SPA", () => {
  const app = new App();
  const stack = new Stack(app, "TestStack", { env: { region: "us-east-1" } });
  // WHEN
  new StaticWebsite(stack, "test-website", {
    name: "example.com",
    type: StaticWebsiteType.SPA,
  });
  // THEN

  expectCDK(stack).to(
    haveResourceLike("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        DefaultCacheBehavior: {
          Compress: true,
          ViewerProtocolPolicy: "redirect-to-https",
        },
        DefaultRootObject: "index.html",
        HttpVersion: "http2",
        CustomErrorResponses: [
          {
            ErrorCode: 403,
            ResponsePagePath: "/index.html",
            ErrorCachingMinTTL: 300,
            ResponseCode: 200,
          },
          {
            ErrorCode: 404,
            ResponsePagePath: "/index.html",
            ErrorCachingMinTTL: 300,
            ResponseCode: 200,
          },
        ],
      },
    })
  );

  // In addition to the fine granular assertions snapshot tests are performed, too
  // expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
});
