# Static Website CDK Construct

This project contains a CDK construct for creating the infrastructure needed for hosting a static website. It also contains templates for CI/CD pipelines for deploying static content and *Single Page Applications* (SPA) to the static website infrastructure.

## Architecture

The infrastructure for hosting consists of the following AWS services:

* AWS S3
* CloudFront
* *ACM*
* *Route 53*
* *Lambda@Edge*

Additionally, the CI/CD pipelines are based on the following AWS services:

* CodePipeline
* *CodeBuild*

## Usage

### Install

To install this construct to your CDK project you need to run

```bash
npm install @Accenture/cna-aws-cdk-patterns
```

### Create Static Website

This CDK Construct contains everything which is needed to create the infrastructure for hosting the Website. Therefore, the following code is sufficient for creating a Stack with the website:

```typescript
import { Construct, Stack, StackProps } from '@aws-cdk/core';
import { StaticWebsite } from '@Accenture/cna-aws-cdk-patterns';

export class StaticWebsiteStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    
    new StaticWebsite(this, 'simple-static-website', {
      name: 'simple-static-website'
    });
  }
}
```

If you have want to use you own custom domain for the static website you can provide a Route 53 Hosted Zone and the domain name as input:

```typescript
import { Construct, Stack, StackProps } from '@aws-cdk/core';
import { StaticWebsite } from '@Accenture/cna-aws-cdk-patterns';

export class StaticWebsiteStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Look up the hosted zone for the domainName in Route 53
    const hostedZone = HostedZone.fromLookup(this, 'hosted-zone', {
      domainName: 'example.com'
    });
    
    new StaticWebsite(this, 'simple-static-website', {
      name: 'simple-static-website',
      hostedZone: hostedZone,
      domainName: 'www.example.com'
    });
  }
}
```

With this configuration a SSL certificate is created in ACM and a DNS record is added to point to the CloudFront distribution.

**Important:** The stack for the website needs to be created in the AWS Region *us-east-1*.

## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template
