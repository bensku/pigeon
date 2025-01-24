import * as pulumi from '@pulumi/pulumi';

const NET_ALLOCATED_IPS: Map<Network, Set<number>> = new Map();

export interface NetworkArgs {
  prefix: string;
}

export class Network extends pulumi.ComponentResource {
  prefix: string;
  bounds: [number, number];
  constructor(
    name: string,
    args: NetworkArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:ipam:Network', name, args, opts);
    this.prefix = args.prefix;

    // Initialize allocated IPs set for this network
    NET_ALLOCATED_IPS.set(this, new Set());

    // Parse prefix into lower and upper bound IPv4 addresses
    const [prefix, mask] = args.prefix.split('/');
    const prefixParts = prefix.split('.').map(Number);
    const maskBits = parseInt(mask, 10);

    // Calculate the number of host bits
    const hostBits = 32 - maskBits;

    // Calculate lower bound (network address)
    const lower = prefixParts[3] & (256 - Math.pow(2, hostBits));
    // Calculate upper bound (broadcast address - 1)
    const upper = lower + Math.pow(2, hostBits) - 2;

    this.bounds = [lower, upper];
  }
}

export interface IpAddressArgs {
  network: Network;
  portRange: [number, number];
}

interface IpAddressDetails extends IpAddressArgs {
  address: string;
}

// FIXME make sure providers don't capture variables from the outer scope
// Save stuff to disk instead, probably?

const ipAddressProvider: pulumi.dynamic.ResourceProvider<
  IpAddressArgs,
  IpAddressDetails
> = {
  async diff(id, olds, news) {
    NET_ALLOCATED_IPS.get(news.network)!.add(ipToNumber(olds.address));
    return { changes: false }; // FIXME this is probably unwise
  },

  async create(inputs) {
    const allocatedIps = NET_ALLOCATED_IPS.get(inputs.network)!;
    const [lower, upper] = inputs.network.bounds;

    // Find first free IP in range
    let address = lower;
    while (address <= upper && allocatedIps.has(address)) {
      address++;
    }

    if (address > upper) {
      throw new Error(`network ${inputs.network} is out of IP addresses`);
    }

    allocatedIps.add(address);
    return { id: crypto.randomUUID(), address: numberToIp(address), ...inputs };
  },

  async delete(id, props) {
    NET_ALLOCATED_IPS.get(props.network)!.delete(ipToNumber(props.address));
  },
};

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
}

function numberToIp(number: number): string {
  return [
    (number >> 24) & 255,
    (number >> 16) & 255,
    (number >> 8) & 255,
    number & 255,
  ].join('.');
}

export class IpAddress extends pulumi.dynamic.Resource {
  readonly address: pulumi.Output<string>;
  readonly portRange: [number, number];

  constructor(
    name: string,
    args: IpAddressArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super(ipAddressProvider, name, args, opts);
    this.portRange = args.portRange;

    // Initialize allocated ports set for this IP address
    IP_ALLOCATED_PORTS.set(this, new Set());
  }
}

const IP_ALLOCATED_PORTS: Map<IpAddress, Set<number>> = new Map();

export interface PortAllocationArgs {
  address: IpAddress;
}

interface PortAllocationDetails extends PortAllocationArgs {
  port: number;
}

const portAllocationProvider: pulumi.dynamic.ResourceProvider<
  PortAllocationArgs,
  PortAllocationDetails
> = {
  async diff(id, olds, news) {
    IP_ALLOCATED_PORTS.get(news.address)!.add(olds.port);
    return { changes: false }; // FIXME this is probably unwise
  },

  async create(inputs) {
    const allocatedPorts = IP_ALLOCATED_PORTS.get(inputs.address)!;
    const [lower, upper] = inputs.address.portRange;

    // Find first free port in range
    let port = lower;
    while (port <= upper && allocatedPorts.has(port)) {
      port++;
    }

    if (port > upper) {
      throw new Error(`address ${inputs.address} is out of ports`);
    }

    allocatedPorts.add(port);
    return { id: crypto.randomUUID(), port, ...inputs };
  },

  async delete(id, props) {
    IP_ALLOCATED_PORTS.get(props.address)!.delete(props.port);
  },
};

export class PortAllocation extends pulumi.dynamic.Resource {
  readonly port: pulumi.Output<number>;

  constructor(
    name: string,
    args: PortAllocationArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super(portAllocationProvider, name, args, opts);
  }
}
