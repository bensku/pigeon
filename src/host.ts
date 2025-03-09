import * as pulumi from '@pulumi/pulumi';
import * as command from '@pulumi/command';
import * as fs from 'fs/promises';
import * as apt from './apt';

interface HostArgs {
  connection: command.remote.CommandArgs['connection'];
}

export class Host extends pulumi.ComponentResource {
  readonly name: string;
  readonly connection: command.remote.CommandArgs['connection'];
  #existingTasks: Map<string, pulumi.Resource> = new Map();

  constructor(
    name: string,
    args: HostArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:host:Host', name, args, opts);
    this.name = name;
    this.connection = args.connection;

    // Prepare required directories
    new command.remote.Command(
      `${name}-mkdirs`,
      {
        connection: this.connection,
        create:
          'mkdir -p /etc/pigeon && mkdir -p /opt/pigeon && mkdir -p /var/pigeon/oci-uploads',
      },
      { parent: this },
    );
  }

  installPackage(packageName: string, opts?: pulumi.ComponentResourceOptions) {
    return this.addSetupTask(
      `package-${packageName}`,
      (host, name) =>
        new apt.Package(
          name,
          { host, name: packageName, removeOnDelete: false },
          opts,
        ),
    );
  }

  addSetupTask<T extends pulumi.Resource>(
    name: string,
    callback: (host: Host, name: string) => T,
  ): T {
    const taskName = `${this.name}-${name}`;
    let task = this.#existingTasks.get(taskName);
    if (!task) {
      task = callback(this, taskName);
      this.#existingTasks.set(taskName, task);
    }
    return task as T;
  }
}
