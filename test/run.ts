import { LocalWorkspace } from '@pulumi/pulumi/automation';

async function runTest(target: string) {
  const app = await import(`./${target}`);
  const stack = await LocalWorkspace.createOrSelectStack(
    {
      projectName: `pigeon-test`,
      stackName: target,
      program: app.pulumiProgram,
    },
    {
      envVars: {
        PULUMI_CONFIG_PASSPHRASE: 'test',
      },
    },
  );
  //stack.workspace.removeStack(stack.name, { force: true });

  await stack.up({ onOutput: console.info });
  if (app.testInfra) {
    await app.testInfra();
  }
  await stack.destroy({ onOutput: console.info });
}

runTest(process.argv[2]);
