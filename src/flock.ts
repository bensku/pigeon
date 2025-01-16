import * as pulumi from '@pulumi/pulumi';
import { local } from '@pulumi/command';

export interface FlockArgs {
  /**
   * Current epoch of the network. This should be periodically increased by 1
   * to create and deploy new CAs to endpoints without downtime.
   */
  epoch: number;

  /**
   * IP range of this network in CIDR notation. Nebula supports IPv4 only for now :(
   *
   * @example 10.1.2.0/24
   */
  ipRange: string;
}

export class Network extends pulumi.ComponentResource {
  name: string;
  #certManagerBinary: string;

  #epochs: [Epoch, Epoch];

  constructor(
    name: string,
    args: FlockArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:flock:Network', name, {}, opts);
    this.name = name;

    // Create CAs for current and previous epoch
    // These get installed to endpoints as trusted CAs
    // The idea is that you can rotate certs by increasing epoch by one and deploying;
    // Pulumi will automatically update endpoints and destroy older CA resources
    // ... without network downtime, of course!
    const caValidity = 7 * 24 * 60 * 60 * 1000; // 1 week
    this.#epochs = [
      this.#createCaForEpoch(
        `${name} CA epoch ${args.epoch - 1}`,
        args.epoch - 1,
        caValidity,
      ),
      this.#createCaForEpoch(
        `${name} CA epoch ${args.epoch}`,
        args.epoch,
        caValidity,
      ),
    ];
  }

  get currentCa() {
    return this.#epochs[1];
  }

  #createCaForEpoch(name: string, epoch: number, validity: number): Epoch {
    const privateKey = certManagerCmd(this, `${name}-epoch-${epoch}-ca-key`, {
      mode: 'ca',
      target: 'key',
    });
    const now = Date.now();
    const certificate = certManagerCmd(this, `${name}-epoch-${epoch}-ca-cert`, {
      mode: 'ca',
      target: 'cert',
      caKey: privateKey,
      caConfig: {
        name: name,
        validNotBefore: new Date(now - 5 * 60 * 1000).toISOString(),
        validNotAfter: new Date(now + validity).toISOString(),
      },
    });
    return { privateKey, certificate };
  }
}

interface Epoch {
  privateKey: pulumi.Output<string>;
  certificate: pulumi.Output<string>;
}

export interface HostArgs {
  network: Network;

  name: string;

  /**
   * Range of ports that Flock network system is allowed to use. Each
   * endpoint, including lighthouses, requires one port.
   *
   * Inclusive, exclusive.
   */
  portRange: [number, number];
}

export class Host extends pulumi.ComponentResource {
  name: string;

  constructor(
    name: string,
    args: HostArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:flock:Host', name, {}, opts);
    this.name = name;
  }

  #createHostCert(ca: Epoch, name: string) {
    // TODO
  }
}

const CERT_MANAGER_BINARY = '';

function certManagerCmd(
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
    env.CERT_CONFIG = JSON.stringify(args.certConfig);
  }
  const cmd = new local.Command(
    `${this.name}-${id}`,
    {
      create: CERT_MANAGER_BINARY,
      environment: env,
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
  hostKey?: string;
  certConfig?: {
    name: string;
    network: string;
    groups: string;
  };
}
