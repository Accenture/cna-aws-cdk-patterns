import { Construct, Stack, StackProps } from '@aws-cdk/core';
import { Artifact, Pipeline, StageProps } from '@aws-cdk/aws-codepipeline';
import { BitBucketSourceAction, CodeBuildAction, S3DeployAction } from '@aws-cdk/aws-codepipeline-actions';
import { IBucket } from '@aws-cdk/aws-s3';
import { BuildSpec, ComputeType, IProject, LinuxBuildImage, PipelineProject } from '@aws-cdk/aws-codebuild';

export enum StaticWebsitePipelineType {
  SIMPLE,
  ANGULAR
}

export interface StaticWebsitePipelineProps {
  type: StaticWebsitePipelineType,
  pipelineName: string,
  bucket: IBucket,
  codeStarConnectionArn: string,
  repository: {
    owner: string,
    name: string,
    branch?: string
  }
}

export class StaticWebsitePipeline extends Construct {
  constructor(scope: Construct, id: string, props: StaticWebsitePipelineProps) {
    super(scope, id);

    let stages = this.simplePipelineStages(props);
    if(props.type === StaticWebsitePipelineType.ANGULAR) {
      stages = this.angularPipelineStage(props);
    }

    new Pipeline(this, 'pipeline', {
        pipelineName: props.pipelineName,
        crossAccountKeys: false,
        stages: stages
    });
  }

  simplePipelineStages(props: StaticWebsitePipelineProps): StageProps[] {
    const sourceArtifact = new Artifact('Source');

    return [
      {
        stageName: 'Source',
        actions: [
          new BitBucketSourceAction({
            actionName: 'Checkout',
            connectionArn: props.codeStarConnectionArn,
            owner: props.repository.owner,
            repo: props.repository.name,
            branch: props.repository.branch,
            output: sourceArtifact
          })
        ]
      },
      {
        stageName: 'Deploy',
        actions: [
          new S3DeployAction({
            actionName: 'Deploy',
            bucket: props.bucket,
            input: sourceArtifact
          })
        ]
      }
    ]
  }

  angularPipelineStage(props: StaticWebsitePipelineProps): StageProps[] {
    const sourceArtifact = new Artifact('Source');
    const deployArtifact = new Artifact('Deploy');

    return [
      {
        stageName: 'Source',
        actions: [
          new BitBucketSourceAction({
            actionName: 'Checkout',
            connectionArn: props.codeStarConnectionArn,
            owner: props.repository.owner,
            repo: props.repository.name,
            branch: props.repository.branch,
            output: sourceArtifact
          })
        ]
      },
      {
        stageName: 'Build',
        actions: [
          new CodeBuildAction({
            actionName: 'Build',
            project: this.angularBuildProject(),
            input: sourceArtifact,
            outputs: [ deployArtifact ]
          })
        ]
      },
      {
        stageName: 'Deploy',
        actions: [
          new S3DeployAction({
            actionName: 'Deploy',
            bucket: props.bucket,
            input: deployArtifact
          })
        ]
      }
    ]
  }

  angularBuildProject(): IProject {
    return new PipelineProject(this, 'build-project', {
      projectName: 'AngularAppBuild',
      environment: {
        computeType: ComputeType.SMALL,
        buildImage: LinuxBuildImage.STANDARD_4_0
      },
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: 12
            },
            commands: [
              'npm install -g @angular/cli@10',
              'npm install'
            ]
          },
          build: {
            commands: [
              'ng build --prod=true --outputPath=dist'
            ]
          }
        },
        artifacts: {
          'base-directory': 'dist',
          files: [
            '**/*'
          ]
        }
      })
    });
  }
}
