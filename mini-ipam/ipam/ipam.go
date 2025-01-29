package ipam

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"

	"github.com/gofrs/flock"
)

type Network struct {
	CIDR      string
	Allocated map[string]string // addressID -> IP
}

func CreateNetwork(networkID, cidr string) error {
	lock, err := acquireNetworkLock(networkID, true)
	if err != nil {
		return fmt.Errorf("failed to acquire lock: %w", err)
	}
	defer releaseNetworkLock(lock)

	if _, _, err := net.ParseCIDR(cidr); err != nil {
		return fmt.Errorf("invalid CIDR: %w", err)
	}

	path := networkPath(networkID)
	if _, err := os.Stat(path); err == nil {
		return fmt.Errorf("network exists")
	}

	return writeNetwork(networkID, &Network{
		CIDR:      cidr,
		Allocated: make(map[string]string),
	})
}

func DestroyNetwork(networkID string) error {
	lock, err := acquireNetworkLock(networkID, true)
	if err != nil {
		return fmt.Errorf("failed to acquire lock: %w", err)
	}
	defer releaseNetworkLock(lock)

	return os.Remove(networkPath(networkID))
}

func AllocateAddress(networkID, addressID string) (string, error) {
	lock, err := acquireNetworkLock(networkID, true)
	if err != nil {
		return "", fmt.Errorf("failed to acquire lock: %w", err)
	}
	defer releaseNetworkLock(lock)

	network, err := readNetwork(networkID)
	if err != nil {
		return "", err
	}

	if _, exists := network.Allocated[addressID]; exists {
		return "", fmt.Errorf("address exists")
	}

	ips, err := generateAvailableIPs(network.CIDR, network.Allocated)
	if err != nil {
		return "", err
	}

	if len(ips) == 0 {
		return "", fmt.Errorf("no available IPs")
	}

	network.Allocated[addressID] = ips[0]
	return ips[0], writeNetwork(networkID, network)
}

func FreeAddress(networkID, addressID string) error {
	lock, err := acquireNetworkLock(networkID, true)
	if err != nil {
		return fmt.Errorf("failed to acquire lock: %w", err)
	}
	defer releaseNetworkLock(lock)

	network, err := readNetwork(networkID)
	if err != nil {
		return err
	}

	if _, exists := network.Allocated[addressID]; !exists {
		return fmt.Errorf("address not found")
	}

	delete(network.Allocated, addressID)
	return writeNetwork(networkID, network)
}

func ListAllocations(networkID string) (map[string]string, error) {
	lock, err := acquireNetworkLock(networkID, false)
	if err != nil {
		return nil, fmt.Errorf("failed to acquire lock: %w", err)
	}
	defer releaseNetworkLock(lock)

	network, err := readNetwork(networkID)
	if err != nil {
		return nil, err
	}
	return network.Allocated, nil
}

func networkPath(networkID string) string {
	return filepath.Join("data", networkID+".json")
}

func readNetwork(networkID string) (*Network, error) {
	data, err := os.ReadFile(networkPath(networkID))
	if err != nil {
		return nil, err
	}

	var network Network
	return &network, json.Unmarshal(data, &network)
}

func writeNetwork(networkID string, network *Network) error {
	data, err := json.Marshal(network)
	if err != nil {
		return err
	}

	if err := os.MkdirAll("data", 0755); err != nil {
		return err
	}

	return os.WriteFile(networkPath(networkID), data, 0644)
}

func generateAvailableIPs(cidr string, allocated map[string]string) ([]string, error) {
	ip, ipnet, err := net.ParseCIDR(cidr)
	if err != nil {
		return nil, err
	}

	allocatedIPs := make(map[string]struct{})
	for _, ip := range allocated {
		allocatedIPs[ip] = struct{}{}
	}

	var ips []string
	for current := ip.Mask(ipnet.Mask); ipnet.Contains(current); incIP(current) {
		if isNetworkIP(current, ipnet) || isBroadcastIP(current, ipnet) {
			continue
		}
		ipStr := current.String()
		if _, exists := allocatedIPs[ipStr]; !exists {
			ips = append(ips, ipStr)
		}
	}

	return ips, nil
}

func incIP(ip net.IP) {
	for j := len(ip) - 1; j >= 0; j-- {
		ip[j]++
		if ip[j] > 0 {
			break
		}
	}
}

func isNetworkIP(ip net.IP, ipnet *net.IPNet) bool {
	return ip.Equal(ipnet.IP)
}

func isBroadcastIP(ip net.IP, ipnet *net.IPNet) bool {
	mask := ipnet.Mask
	broadcast := make(net.IP, len(ip))
	for i := range ip {
		broadcast[i] = ip[i] | ^mask[i]
	}
	return ip.Equal(broadcast)
}

func acquireNetworkLock(networkID string, exclusive bool) (*flock.Flock, error) {
	lockFile := filepath.Join("data", networkID+".lock")
	lock := flock.New(lockFile)
	var err error
	if exclusive {
		err = lock.Lock()
	} else {
		err = lock.RLock()
	}
	if err != nil {
		return nil, err
	}
	return lock, nil
}

func releaseNetworkLock(lock *flock.Flock) error {
	return lock.Unlock()
}
