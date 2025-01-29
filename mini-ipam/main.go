package main

import (
	"fmt"
	"log"
	"os"

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
  create-network <network-id> <cidr>
  destroy-network <network-id>
  allocate-address <network-id> <address-id>
  free-address <network-id> <address-id>
  list-allocations <network-id>`)
}
