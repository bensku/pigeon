import * as pulumi from '@pulumi/pulumi';
import * as command from '@pulumi/command';
import * as host from './host';
import * as ssh from './ssh';

export interface ServiceArgs {
  host: host.Host;
  name: pulumi.Input<string>;
  serviceSuffix?: string;
  fileSuffix?: string;
  unitFile: pulumi.Input<string>;
  unitDir?: string;
  transient?: boolean;

  triggers?: any[];
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

    new ssh.RunActions(
      `${name}-actions`,
      {
        connection: args.host.connection,
        actions: sshActions(args),
        triggers: args.triggers,
      },
      { parent: this, dependsOn: args.host, deleteBeforeReplace: true },
    );
  }
}

export function sshActions(args: ServiceArgs): ssh.Action[] {
  const serviceName = pulumi.interpolate`${args.name}${args.serviceSuffix ?? ''}`;
  const actions: ssh.Action[] = [
    {
      type: 'upload',
      data: args.unitFile,
      remotePath: pulumi.interpolate`${args.unitDir ?? '/etc/systemd/system/'}/${args.name}${args.fileSuffix ?? '.service'}`,
    },
  ];
  if (args.transient) {
    actions.push({
      type: 'command',
      create: pulumi.interpolate`systemctl daemon-reload && systemctl restart ${serviceName}`,
      // TODO do we actually need to stop?
      delete: pulumi.interpolate`systemctl stop ${serviceName} && systemctl daemon-reload`,
    });
  } else {
    actions.push({
      type: 'command',
      create: pulumi.interpolate`systemctl daemon-reload && systemctl enable --now ${serviceName}`,
      delete: pulumi.interpolate`systemctl disable --now ${serviceName} && systemctl daemon-reload`,
    });
  }

  return actions;
}
