import { Construct, Duration, Stack } from '@aws-cdk/core';
import { BlockPublicAccess, Bucket, BucketEncryption } from '@aws-cdk/aws-s3';
import { Distribution, ErrorResponse, HttpVersion, ViewerProtocolPolicy } from '@aws-cdk/aws-cloudfront';
import { S3Origin } from '@aws-cdk/aws-cloudfront-origins';
import { Certificate, CertificateValidation, ICertificate } from '@aws-cdk/aws-certificatemanager';
import { RecordSet, RecordType, RecordTarget, IHostedZone } from '@aws-cdk/aws-route53';
import { CloudFrontTarget } from '@aws-cdk/aws-route53-targets';
import { AccountRootPrincipal, Effect, PolicyStatement } from '@aws-cdk/aws-iam';

/**
 * The type of web application which will be hosted.
 */
export enum StaticWebsiteType {
  /**
   * Simple, static content, like HTML pages, CSS and JS files, images, etc.
   */
  SIMPLE,

  /**
   * Single Page Applications (SPA), like Angular, React or vue.js applications
   */
  SPA
}

export interface StaticWebsiteProps {
  name: string,

  /**
   * The type of static website, either SIMPLE or SPA.
   */
  type: StaticWebsiteType,

  /**
   * The Route 53 Hosted Zone to which the DNS record for the static website should be added.
   * Additionally, this Hosted Zone will be used for validating the accompanied SSL certificate.
   */
  hostedZone?: IHostedZone,

  /**
   * The domain name for the static website. It must be matching the Hosted Zone.
   */
  domainName?: string
}

interface StaticWebsiteDistributionProps {
  type: StaticWebsiteType,
  domainNames?: string[],
  certificate?: ICertificate
}

export class StaticWebsite extends Construct {
  public readonly contentBucket: Bucket;
  private readonly loggingBucket: Bucket;

  constructor(scope: Construct, id: string, props: StaticWebsiteProps) {
    super(scope, id);
    
    // Create the S3 bucket for storing the content served via CloudFront
    this.contentBucket = this.createEncryptedBucket('content-bucket', `site-${props.name}-content`);

    // Create the S3 bucket for storing the logs from CloudFront
    this.loggingBucket = this.createEncryptedBucket('logging-bucket', `site-${props.name}-logs`);

    if(props.hostedZone && props.domainName) {
      // Create a CloudFront distribution with a custom domain name
      this.createCloudFrontDistributionWithCustomDomain(props);
    } else {
      // Create a CloudFront distribution with an automatically generated domain name
      this.createCloudFrontDistribution({
        type: props.type
      });
    }
  }

  private createEncryptedBucket(id: string, bucketName: string): Bucket {
    var bucket = new Bucket(this, id, {
      bucketName: bucketName,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED
    });

    bucket.addToResourcePolicy(new PolicyStatement({
      sid: 'DenyIncorrectEncryptionHeader',
      effect: Effect.DENY,
      actions: [
        's3:PutObject'
      ],
      principals: [
        new AccountRootPrincipal()
      ],
      resources: [
        bucket.bucketArn + '/*'
      ],
      conditions: {
        'StringNotEquals': {
          's3:x-amz-server-side-encryption': 'AES256'
        }
      }
    }));

    bucket.addToResourcePolicy(new PolicyStatement({
      sid: 'DenyUnencryptedObjectUploads',
      effect: Effect.DENY,
      actions: [
        's3:PutObject'
      ],
      principals: [
        new AccountRootPrincipal()
      ],
      resources: [
        bucket.bucketArn + '/*'
      ],
      conditions: {
        'Null': {
          's3:x-amz-server-side-encryption': true
        }
      }
    }));

    return bucket;
  }

  private createCloudFrontDistribution(props: StaticWebsiteDistributionProps): Distribution {
    let errorResponses: ErrorResponse[] = [];
    if(props.type == StaticWebsiteType.SPA) {
      errorResponses = [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5)
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5)
        }
      ]
    }

    return new Distribution(this, 'distribution', {
      defaultBehavior: {
        origin: new S3Origin(this.contentBucket),
        compress: true,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      domainNames: props.domainNames,
      certificate: props.certificate,
      defaultRootObject: 'index.html',
      httpVersion: HttpVersion.HTTP2,
      logBucket: this.loggingBucket,
      errorResponses: errorResponses
    });
  }

  private createCloudFrontDistributionWithCustomDomain(props: StaticWebsiteProps) {
    const hostedZone = props.hostedZone!;
    const domainName = props.domainName!;

    // Create a certificate for the domain
    const certificate = new Certificate(this, 'certificate', {
      domainName: domainName,
      validation: CertificateValidation.fromDns(hostedZone)
    });

    // Create the CloudFront distribution with the domain and related SSL certificate
    const distribution = this.createCloudFrontDistribution({
      type: props.type,
      domainNames: [ domainName ],
      certificate: certificate
    });

    // Create the DNS record in the Hosted Zone
    new RecordSet(this, 'cloudfront-alias-record', {
      zone: hostedZone,
      recordName: domainName,
      recordType: RecordType.A,
      target: RecordTarget.fromAlias(new CloudFrontTarget(distribution))
    });
  }

  protected validate(): string[] {
    const stack = Stack.of(this);
    // The static website and all its components must be created in the AWS region "us-east-1"
    if(stack.region !== 'us-east-1') {
      return [ 'The static website must be created in the region "us-east-1"' ];
    }
    return [];
  }
}
