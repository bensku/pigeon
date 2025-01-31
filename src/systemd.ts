import * as pulumi from '@pulumi/pulumi';
import * as command from '@pulumi/command';
import * as host from './host';

export interface ServiceArgs {
  host: host.Host;
  name: pulumi.Input<string>;
  serviceSuffix?: string;
  fileSuffix?: string;
  unitFile: pulumi.Input<pulumi.asset.Asset>;
  unitDir?: string;
  transient?: boolean;
}

export class Service extends pulumi.ComponentResource {
  serviceName: pulumi.Output<string>;

  constructor(
    name: string,
    args: ServiceArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:systemd:Service', name, args, opts);
    this.serviceName = pulumi.interpolate`${args.name}${args.serviceSuffix ?? ''}`;

    const copyUnit = new host.FileUpload(
      `${name}-copy-unit`,
      {
        host: args.host,
        source: args.unitFile,
        remotePath: pulumi.interpolate`${args.unitDir ?? '/etc/systemd/system/'}/${args.name}${args.fileSuffix ?? ''}`,
      },
      { parent: this, dependsOn: args.host },
    );

    if (!args.transient) {
      new command.remote.Command(
        `${name}-enable`,
        {
          connection: args.host.connection,
          create: pulumi.interpolate`systemctl daemon-reload && systemctl enable --now ${this.serviceName}`,
          delete: pulumi.interpolate`systemctl disable --now ${this.serviceName} && systemctl daemon-reload`,
        },
        { parent: this, dependsOn: copyUnit },
      );
    } else {
      new command.remote.Command(
        `${name}-enable`,
        {
          connection: args.host.connection,
          create: pulumi.interpolate`systemctl daemon-reload && systemctl start ${this.serviceName}`,
          delete: pulumi.interpolate`systemctl stop ${this.serviceName} && systemctl daemon-reload`,
        },
        { parent: this, dependsOn: copyUnit },
      );
    }
  }
}
