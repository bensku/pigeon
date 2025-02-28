import * as pulumi from '@pulumi/pulumi';
import * as command from '@pulumi/command';
import { NodeSSH } from 'node-ssh';

export type Action = CommandAction | UploadAction;

export interface CommandAction {
  type: 'command';
  create: pulumi.Input<string>;
  delete?: pulumi.Input<string>;
}

export interface UploadAction {
  type: 'upload';
  data: pulumi.Input<string>;
  remotePath: pulumi.Input<string>;
}

export interface SshResourceArgs {
  connection: command.remote.CommandArgs['connection'];
  actions: Action[];
  triggers?: any[];
}

interface SshProviderArgs {
  connection: pulumi.Unwrap<command.remote.CommandArgs['connection']>;
  actions: pulumi.Unwrap<Action>[];
  triggers?: any[];
}

class SshProvider implements pulumi.dynamic.ResourceProvider {
  async create(inputs: SshProviderArgs): Promise<pulumi.dynamic.CreateResult> {
    const { connection, actions } = inputs;

    // Establish an SSH connection
    const ssh = await connectSSH(connection);

    // Execute all actions in the provided order
    try {
      for (const action of actions) {
        await runCreateAction(ssh, action);
      }
    } finally {
      ssh.dispose();
    }

    // Return a unique ID and persist the input state for use in delete.
    return {
      id: crypto.randomUUID(),
      outs: inputs,
    };
  }

  // Simple diff implementation that forces replacement if connection or actions change.
  async diff(
    _id: string,
    oldOutputs: any,
    newInputs: any,
  ): Promise<pulumi.dynamic.DiffResult> {
    const replaces = ['connection', 'actions', 'triggers'];
    let replace = false;
    for (const key of replaces) {
      // TODO normal deep equality check... ?
      if (JSON.stringify(oldOutputs[key]) !== JSON.stringify(newInputs[key])) {
        replace = true;
        break;
      }
    }
    return {
      changes: replace,
      replaces: replace ? replaces : [],
    };
  }

  async delete(_id: string, props: SshProviderArgs): Promise<void> {
    const { connection, actions } = props;

    const ssh = await connectSSH(connection);

    // Reverse order of actions for deletion
    try {
      for (const action of [...actions].reverse()) {
        await runDeleteAction(ssh, action);
      }
    } finally {
      ssh.dispose();
    }
  }
}

export class RunActions extends pulumi.dynamic.Resource {
  constructor(
    name: string,
    args: SshResourceArgs,
    opts?: pulumi.CustomResourceOptions,
  ) {
    super(new SshProvider(), name, args, opts);
  }
}

export async function connectSSH(
  connection: pulumi.Unwrap<command.remote.CommandArgs['connection']>,
): Promise<NodeSSH> {
  const ssh = new NodeSSH();
  await ssh.connect({
    host: connection.host,
    port: connection.port ?? 22,
    username: connection.user,
    password: connection.password,
    privateKey: connection.privateKey,
  });
  return ssh;
}

async function runCreateAction(
  ssh: NodeSSH,
  action: pulumi.Unwrap<Action>,
): Promise<void> {
  const fs = await import('fs/promises');
  switch (action.type) {
    case 'command':
      console.log(`run: ${action.create}`);
      const cmdResult = await ssh.execCommand(action.create);
      console.log(cmdResult.stdout);
      if (cmdResult.code != 0) {
        throw new Error(`Exit ${cmdResult.code} != 0: ${cmdResult.stderr}`);
      }
      break;
    case 'upload':
      // Write to temporary file
      const tmpPath = `/tmp/${crypto.randomUUID()}`;
      try {
        await fs.writeFile(tmpPath, action.data);
        await ssh.putFile(tmpPath, action.remotePath);
      } finally {
        await fs.unlink(tmpPath); // TODO cleanup if we somehow crash before this
      }
      break;
  }
}

async function runDeleteAction(
  ssh: NodeSSH,
  action: pulumi.Unwrap<Action>,
): Promise<void> {
  switch (action.type) {
    case 'command':
      // If a deleteCommand is provided for a command, run it. Otherwise, do nothing.
      if (action.delete) {
        console.log(`run: ${action.delete}`);
        const delCmdResult = await ssh.execCommand(action.delete);
        if (delCmdResult.code != 0) {
          // Be intentionally more forgiving when deleting, we don't want THAT to fail!
          // TODO make this configurable?
          console.error(
            `Error executing delete command: ${delCmdResult.stderr}`,
          );
        } else {
          console.log(delCmdResult.stdout);
        }
      }
      break;
    case 'upload':
      // For uploads, if no deleteCommand is provided, default to deleting the remote file.
      await ssh.execCommand(`rm -f ${action.remotePath}`);
      break;
  }
}
