import { Construct } from "@aws-cdk/core";
import { Repository as CodeCommitRepo } from "@aws-cdk/aws-codecommit";
import { Artifact, Pipeline } from "@aws-cdk/aws-codepipeline";
import {
  CodeCommitSourceAction,
  CodeBuildAction,
  CodeDeployEcsDeployAction,
} from "@aws-cdk/aws-codepipeline-actions";
import { IBucket } from "@aws-cdk/aws-s3";
import {
  BuildSpec,
  ComputeType,
  IProject,
  LinuxBuildImage,
  PipelineProject,
} from "@aws-cdk/aws-codebuild";
import { PropagatedTagSource } from "@aws-cdk/aws-ecs";

import { Repository as EcrRepo } from "@aws-cdk/aws-ecr";

interface DockerBackendPipelineProps {
  appName: string;
  pipelineName: string;
  bucket: IBucket;
  codeStarConnectionArn: string;
  repository: {
    owner: string;
    name: string;
    branch?: string;
  };
}

export class DockerBackendPipeline extends Construct {
  constructor(scope: Construct, id: string, props: DockerBackendPipelineProps) {
    super(scope, id);

    const sourceArtifact = new Artifact("Source");
    const deployArtifact = new Artifact("Deploy");

    const codeCommitRepo = new CodeCommitRepo(this, props.appName, {
      repositoryName: props.appName,
    });

    const ecrRepo = new EcrRepo(this, props.appName, {
      repositoryName: props.appName,
    });

    new Pipeline(this, "pipeline", {
      pipelineName: props.pipelineName,
      crossAccountKeys: false,
      stages: [
        {
          stageName: "Source",
          actions: [
            new CodeCommitSourceAction({
              actionName: "Checkout",
              repository: codeCommitRepo,
              output: sourceArtifact,
            }),
          ],
        },
        {
          stageName: "Build",
          actions: [
            new CodeBuildAction({
              actionName: "Build",
              project: this.mavenBuildProject(ecrRepo.repositoryUri),
              input: sourceArtifact,
              outputs: [deployArtifact],
            }),
          ],
        },
        {
          stageName: "Deploy",
          actions: [
            new CodeBuildAction({
              actionName: "Build",
              project: this.cdkDeployProject(ecrRepo.repositoryUri),
              input: sourceArtifact,
              outputs: [deployArtifact],
            }),
          ],
        },
      ],
    });
  }

  cdkDeployProject(repoUri: string): IProject {
    return new PipelineProject(this, "build-project", {
      projectName: "MavenDockerBuild",
      environment: {
        computeType: ComputeType.SMALL,
        buildImage: LinuxBuildImage.STANDARD_4_0,
      },
      buildSpec: BuildSpec.fromObject({
        version: "0.2",
        phases: {
          preBuild: {
            commands: [
              "$(aws ecr get-login --no-include-email)",
              'TAG="$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | head -c 8)"',
              'IMAGE_URI="' + repoUri + '":latest',
            ],
          },
          build: {
            commands: [
              "mvn clean package",
              'docker build --tag "$IMAGE_URI" .',
            ],
          },
          postBuild: {
            commands: [
              'docker push "$IMAGE_URI"',
              'printf \'[{"name":"%s","imageUri":"%s"}]\' "$CONTAINER_NAME" "$IMAGE_URI" > images.json',
            ],
          },
        },
        artifacts: {
          files: "images.json",
        },
      }),
    });
  }

  mavenBuildProject(repoUri: string): IProject {
    return new PipelineProject(this, "build-project", {
      projectName: "MavenDockerBuild",
      environment: {
        computeType: ComputeType.SMALL,
        buildImage: LinuxBuildImage.STANDARD_4_0,
      },
      buildSpec: BuildSpec.fromObject({
        version: "0.2",
        phases: {
          preBuild: {
            commands: [
              "$(aws ecr get-login --no-include-email)",
              'TAG="$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | head -c 8)"',
              'IMAGE_URI="' + repoUri + '":latest',
            ],
          },
          build: {
            commands: [
              "mvn clean package",
              'docker build --tag "$IMAGE_URI" .',
            ],
          },
          postBuild: {
            commands: [
              'docker push "$IMAGE_URI"',
              'printf \'[{"name":"%s","imageUri":"%s"}]\' "$CONTAINER_NAME" "$IMAGE_URI" > images.json',
            ],
          },
        },
        artifacts: {
          files: "images.json",
        },
      }),
    });
  }
}
