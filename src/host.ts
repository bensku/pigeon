import * as pulumi from '@pulumi/pulumi';
import * as command from '@pulumi/command';

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
