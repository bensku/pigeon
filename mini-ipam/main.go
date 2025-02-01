package main

import (
	"fmt"
	"log"
	"os"
	"strconv"

	"github.com/bensku/pigeon/mini-ipam/ipam"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	switch os.Args[1] {
	case "create-network":
		if len(os.Args) != 4 {
			log.Fatal("Usage: create-network <network-id> <cidr>")
		}
		err := ipam.CreateNetwork(os.Args[2], os.Args[3])
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println("Network created")

	case "destroy-network":
		if len(os.Args) != 3 {
			log.Fatal("Usage: destroy-network <network-id>")
		}
		err := ipam.DestroyNetwork(os.Args[2])
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println("Network destroyed")

	case "allocate-address":
		if len(os.Args) != 4 {
			log.Fatal("Usage: allocate-address <network-id> <address-id>")
		}
		ip, err := ipam.AllocateAddress(os.Args[2], os.Args[3])
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println(ip)

	case "free-address":
		if len(os.Args) != 4 {
			log.Fatal("Usage: free-address <network-id> <address-id>")
		}
		err := ipam.FreeAddress(os.Args[2], os.Args[3])
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println("Address freed")

	case "list-allocations":
		if len(os.Args) != 3 {
			log.Fatal("Usage: list-allocations <network-id>")
		}
		allocations, err := ipam.ListAllocations(os.Args[2])
		if err != nil {
			log.Fatal(err)
		}
		if len(allocations) == 0 {
			fmt.Println("No allocations")
			return
		}
		for id, ip := range allocations {
			fmt.Printf("%s: %s\n", id, ip)
		}

	case "create-host":
		if len(os.Args) != 5 {
			log.Fatal("Usage: create-host <host-id> <start-port> <end-port>")
		}
		start, err := strconv.Atoi(os.Args[3])
		if err != nil {
			log.Fatal("Invalid start port:", err)
		}
		end, err := strconv.Atoi(os.Args[4])
		if err != nil {
			log.Fatal("Invalid end port:", err)
		}
		err = ipam.CreateHost(os.Args[2], start, end)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println("Host created")

	case "delete-host":
		if len(os.Args) != 3 {
			log.Fatal("Usage: delete-host <host-id>")
		}
		err := ipam.DeleteHost(os.Args[2])
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println("Host deleted")

	case "allocate-port":
		if len(os.Args) != 4 {
			log.Fatal("Usage: allocate-port <host-id> <port-id>")
		}
		port, err := ipam.AllocatePort(os.Args[2], os.Args[3])
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println(port)

	case "free-port":
		if len(os.Args) != 4 {
			log.Fatal("Usage: free-port <host-id> <port-id>")
		}
		err := ipam.FreePort(os.Args[2], os.Args[3])
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println("Port freed")

	case "list-ports":
		if len(os.Args) != 3 {
			log.Fatal("Usage: list-ports <host-id>")
		}
		ports, err := ipam.ListPorts(os.Args[2])
		if err != nil {
			log.Fatal(err)
		}
		if len(ports) == 0 {
			fmt.Println("No ports allocated")
			return
		}
		for id, port := range ports {
			fmt.Printf("%s: %d\n", id, port)
		}

	default:
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println(`IPAM CLI

Usage:
  ipam <command> [arguments]

Commands:
  NETWORK MANAGEMENT:
  create-network <network-id> <cidr>
  destroy-network <network-id>
  allocate-address <network-id> <address-id>
  free-address <network-id> <address-id>
  list-allocations <network-id>

  HOST MANAGEMENT:
  create-host <host-id> <start-port> <end-port>
  delete-host <host-id>
  allocate-port <host-id> <port-id>
  free-port <host-id> <port-id>
  list-ports <host-id>`)
}
