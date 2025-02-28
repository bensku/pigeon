import * as pulumi from '@pulumi/pulumi';
import * as command from '@pulumi/command';
import * as host from './host';

export interface PackageArgs {
  host: host.Host;
  name: string;
  removeOnDelete?: boolean;
}

export class Package extends pulumi.ComponentResource {
  constructor(
    name: string,
    args: PackageArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:apt:Package', name, args, opts);

    new command.remote.Command(
      `${name}-install`,
      {
        connection: args.host.connection,
        create: `apt-get -qq update && apt-get install -qq ${args.name}`,
        delete: args.removeOnDelete
          ? `apt-get remove -qq ${args.name}`
          : undefined,
        addPreviousOutputInEnv: false,
      },
      { parent: this, dependsOn: args.host },
    );
  }
}
