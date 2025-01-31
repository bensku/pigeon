import * as pulumi from '@pulumi/pulumi';
import * as command from '@pulumi/command';
import * as fs from 'fs/promises';

interface HostArgs {
  connection: command.remote.CommandArgs['connection'];
}

export class Host extends pulumi.ComponentResource {
  readonly connection: command.remote.CommandArgs['connection'];

  constructor(
    name: string,
    args: HostArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:host:Host', name, {}, opts);
    this.connection = args.connection;

    // Prepare required directories
    new command.remote.Command(
      name,
      {
        connection: this.connection,
        create: 'mkdir -p /etc/pigeon && mkdir -p /opt/pigeon',
      },
      { parent: this },
    );
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
        delete: pulumi.interpolate`rm "${args.remotePath}"`,
      },
      { parent: this, dependsOn: upload },
    );
  }
}
