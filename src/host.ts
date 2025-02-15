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
    super('pigeon:host:Host', name, {}, opts);
    this.name = name;
    this.connection = args.connection;

    // Prepare required directories
    new command.remote.Command(
      name,
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
      (host, name) => new apt.Package(name, { host, name: packageName }, opts),
    );
  }

  addSetupTask(
    name: string,
    callback: (host: Host, name: string) => pulumi.Resource,
  ) {
    const taskName = `${this.name}-${name}`;
    let task = this.#existingTasks.get(taskName);
    if (!task) {
      task = callback(this, taskName);
      this.#existingTasks.set(taskName, task);
    }
    return task;
  }
}

export interface FileUploadArgs {
  host: Host;
  source: pulumi.Input<pulumi.asset.Asset>;
  remotePath: pulumi.Input<string>;

  chmod?: string;
}

export class FileUpload extends pulumi.ComponentResource {
  constructor(
    name: string,
    args: FileUploadArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:host:FileUpload', name, args, opts);

    const upload = new command.remote.CopyToRemote(
      name,
      {
        connection: args.host.connection,
        source: pulumi.output(args.source).apply(async (asset) => {
          if ('path' in asset) {
            return asset;
          } else if ('text' in asset) {
            // CopyToRemote doesn't support StringAsset, so make a temporary file for a FileAsset
            const tmpPath = `/tmp/${name}`;
            // @ts-ignore instanceof checks are not working :/
            await fs.writeFile(tmpPath, await asset.text);
            return new pulumi.asset.FileAsset(tmpPath);
          }
          throw new Error(`unsupported asset type: ${asset.constructor.name}`);
        }),
        remotePath: args.remotePath,
      },
      { parent: this },
    );
    if (args.chmod) {
      new command.remote.Command(
        `${name}-chmod`,
        {
          connection: args.host.connection,
          create: pulumi.interpolate`chmod ${args.chmod} "${args.remotePath}"`,
        },
        { parent: this, dependsOn: upload },
      );
    }

    new command.remote.Command(
      `${name}-cleanup`,
      {
        connection: args.host.connection,
        delete: pulumi.interpolate`rm "${upload.remotePath}"`,
      },
      { parent: this, dependsOn: upload },
    );
  }
}
