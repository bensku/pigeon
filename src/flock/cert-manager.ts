import * as command from '@pulumi/command';
import * as pulumi from '@pulumi/pulumi';

const CERT_MANAGER_BINARY = 'nebula-cert-manager/nebula-cert-manager';

export function certManagerCmd(
  parent: pulumi.Resource,
  id: string,
  args: CertManagerArgs,
) {
  const env: Record<string, pulumi.Input<string>> = {
    MANAGER_MODE: args.mode,
    MANAGER_TARGET: args.target,
  };
  if (args.caKey) {
    env.CA_KEY = args.caKey;
  }
  if (args.caConfig) {
    env.CA_CONFIG = JSON.stringify(args.caConfig);
  }
  if (args.caCert) {
    env.CA_CERT = args.caCert;
  }
  if (args.hostKey) {
    env.HOST_KEY = args.hostKey;
  }
  if (args.certConfig) {
    env.CERT_CONFIG = pulumi.jsonStringify(args.certConfig);
  }
  const cmd = new command.local.Command(
    id,
    {
      create: CERT_MANAGER_BINARY,
      environment: env,
      logging: command.local.Logging.Stderr, // stdout is a secret!
    },
    {
      parent,
      additionalSecretOutputs: ['stdout'],
    },
  );
  return cmd.stdout;
}

interface CertManagerArgs {
  mode: 'ca' | 'host';
  target: 'key' | 'cert';
  caKey?: pulumi.Input<string>;
  caConfig?: {
    name: string;
    validNotBefore: string;
    validNotAfter: string;
  };
  caCert?: pulumi.Input<string>;
  hostKey?: pulumi.Input<string>;
  certConfig?: {
    name: pulumi.Input<string>;
    network: pulumi.Input<string>;
    groups: pulumi.Input<string[]>;
    validNotBefore: pulumi.Input<string>;
    validNotAfter: pulumi.Input<string>;
  };
}
