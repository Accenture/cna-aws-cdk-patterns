import * as cdk from '@aws-cdk/core';
import { SynthUtils } from '@aws-cdk/assert';
import '@aws-cdk/assert/jest';
import { StaticWebsitePipeline, StaticWebsitePipelineType } from '../lib/static-website-pipeline';
import { Bucket } from '@aws-cdk/aws-s3';

test('Simple pipeline has two stages', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    // WHEN
    new StaticWebsitePipeline(stack, 'test-website-pipeline', {
        type: StaticWebsitePipelineType.SIMPLE,
        pipelineName: 'test-pipeline',
        bucket: new Bucket(stack, 'bucket'),
        codeStarConnectionArn: '',
        repository: {
            owner: 'test',
            name: 'website'
        }
    });
    // THEN
    expect(stack).toHaveResourceLike('AWS::CodePipeline::Pipeline', {
        Name: 'test-pipeline',
        Stages: [
            {
                Name: 'Source',
                Actions: [
                    {
                        Name: 'Checkout'
                    }
                ]
            },
            {
                Name: 'Deploy',
                Actions: [
                    {
                        Name: 'Deploy'
                    }
                ]
            }
        ]
    });

    // In addition to the fine granular assertions snapshot tests are performed, too
    expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
});

test('Angular pipeline has three stages', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    // WHEN
    new StaticWebsitePipeline(stack, 'test-website-pipeline', {
        type: StaticWebsitePipelineType.ANGULAR,
        pipelineName: 'test-pipeline',
        bucket: new Bucket(stack, 'bucket'),
        codeStarConnectionArn: '',
        repository: {
            owner: 'test',
            name: 'website'
        }
    });
    // THEN
    expect(stack).toHaveResourceLike('AWS::CodePipeline::Pipeline', {
        Name: 'test-pipeline',
        Stages: [
            {
                Name: 'Source',
                Actions: [
                    {
                        Name: 'Checkout'
                    }
                ]
            },
            {
                Name: 'Build',
                Actions: [
                    {
                        Name: 'Build'
                    }
                ]
            },
            {
                Name: 'Deploy',
                Actions: [
                    {
                        Name: 'Deploy'
                    }
                ]
            }
        ]
    });

    // In addition to the fine granular assertions snapshot tests are performed, too
    expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
});
