import { Construct } from "@aws-cdk/core";
import { Repository as CodeCommitRepo } from "@aws-cdk/aws-codecommit";
import { Artifact, Pipeline } from "@aws-cdk/aws-codepipeline";
import {
  CodeCommitSourceAction,
  CodeBuildAction,
  CodeDeployEcsDeployAction,
} from "@aws-cdk/aws-codepipeline-actions";
import {
  BuildSpec,
  ComputeType,
  IProject,
  LinuxBuildImage,
  PipelineProject,
} from "@aws-cdk/aws-codebuild";
import { Repository as EcrRepo } from "@aws-cdk/aws-ecr";
import { IEcsDeploymentGroup } from "@aws-cdk/aws-codedeploy";

/**
 *
 * This is not complete yet, because the desirable Blue/Green Deployment one can setup for ECS via CodeDeploy is not in Cfn / CDK yet.
 *  There is a workaround with custom resouces: https://www.npmjs.com/package/@cloudcomponents/cdk-blue-green-container-deployment
 *  We should generally take a look at https://github.com/cloudcomponents/cdk-constructs they have done some of the things we're doing
 * Also for this pipeline to work the repo requires the two files taskdef.json and appspec.yaml in the root of the repo
 *
 * To be discussed: Should the code repo be an input or created by this stack. If the repo is created by this stack the first run of the pipeline will always fail
 *
 */

interface DockerBackendPipelineProps {
  appName: string;
  pipelineName: string;
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
        /*{
          stageName: "Deploy",
          actions: [this.deployAction(deployArtifact, {})], // not in Cfn yet: https://docs.aws.amazon.com/cdk/api/latest/typescript/api/aws-codedeploy/ecsdeploymentgroup.html#aws_codedeploy_EcsDeploymentGroup
        },*/
      ],
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
              "echo looking for necessary files appspec.yaml and taskdef.json in root folder if this repo",
              "ls appspec.yaml && ls taskdef.json",
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
              'printf \'[{"name":"%s","imageUri":"%s"}]\' "$CONTAINER_NAME" "$IMAGE_URI" > imageDetails.json',
            ],
          },
        },
        artifacts: {
          files: ["imageDetails.json", "appspec.yaml", "taskdef.json"],
        },
      }),
    });
  }

  deployAction(
    deployArtifact: Artifact,
    deploymentGroup: IEcsDeploymentGroup
  ): CodeDeployEcsDeployAction {
    return new CodeDeployEcsDeployAction({
      actionName: "deploy",
      appSpecTemplateInput: deployArtifact, // appspec.yaml
      containerImageInputs: [
        {
          input: deployArtifact, // imageDetails.json
          taskDefinitionPlaceholder: "<IMAGE_URI>", // this is the placeholder
        },
      ],
      deploymentGroup: deploymentGroup, // not in Cfn yet: https://docs.aws.amazon.com/cdk/api/latest/typescript/api/aws-codedeploy/ecsdeploymentgroup.html#aws_codedeploy_EcsDeploymentGroup
      taskDefinitionTemplateInput: deployArtifact, // taskdef.json
    });
  }
}
