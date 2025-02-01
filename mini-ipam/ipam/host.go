package ipam

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/gofrs/flock"
)

type Host struct {
	PortRangeStart int            `json:"portRangeStart"`
	PortRangeEnd   int            `json:"portRangeEnd"`
	AllocatedPorts map[string]int `json:"allocatedPorts"` // portID -> port number
}

func CreateHost(hostID string, startPort, endPort int) error {
	lock, err := acquireHostLock(hostID, true)
	if err != nil {
		return fmt.Errorf("failed to acquire lock: %w", err)
	}
	defer releaseHostLock(lock)

	path := hostPath(hostID)
	if _, err := os.Stat(path); err == nil {
		return fmt.Errorf("host exists")
	}

	if startPort < 1 || endPort > 65535 {
		return fmt.Errorf("port range must be between 1 and 65535")
	}
	if startPort > endPort {
		return fmt.Errorf("start port must be <= end port")
	}

	host := &Host{
		PortRangeStart: startPort,
		PortRangeEnd:   endPort,
		AllocatedPorts: make(map[string]int),
	}

	return writeHost(hostID, host)
}

func DeleteHost(hostID string) error {
	lock, err := acquireHostLock(hostID, true)
	if err != nil {
		return fmt.Errorf("failed to acquire lock: %w", err)
	}
	defer releaseHostLock(lock)

	return os.Remove(hostPath(hostID))
}

func AllocatePort(hostID, portID string) (int, error) {
	lock, err := acquireHostLock(hostID, true)
	if err != nil {
		return 0, fmt.Errorf("failed to acquire lock: %w", err)
	}
	defer releaseHostLock(lock)

	host, err := readHost(hostID)
	if err != nil {
		return 0, err
	}

	if _, exists := host.AllocatedPorts[portID]; exists {
		return 0, fmt.Errorf("port ID already allocated")
	}

	usedPorts := make(map[int]struct{})
	for _, p := range host.AllocatedPorts {
		usedPorts[p] = struct{}{}
	}

	var allocatedPort int
	for p := host.PortRangeStart; p <= host.PortRangeEnd; p++ {
		if _, used := usedPorts[p]; !used {
			allocatedPort = p
			break
		}
	}

	if allocatedPort == 0 {
		return 0, fmt.Errorf("no available ports in host's range")
	}

	host.AllocatedPorts[portID] = allocatedPort
	return allocatedPort, writeHost(hostID, host)
}

func FreePort(hostID, portID string) error {
	lock, err := acquireHostLock(hostID, true)
	if err != nil {
		return fmt.Errorf("failed to acquire lock: %w", err)
	}
	defer releaseHostLock(lock)

	host, err := readHost(hostID)
	if err != nil {
		return err
	}

	if _, exists := host.AllocatedPorts[portID]; !exists {
		return fmt.Errorf("port ID not found")
	}

	delete(host.AllocatedPorts, portID)
	return writeHost(hostID, host)
}

func ListPorts(hostID string) (map[string]int, error) {
	lock, err := acquireHostLock(hostID, false)
	if err != nil {
		return nil, fmt.Errorf("failed to acquire lock: %w", err)
	}
	defer releaseHostLock(lock)

	host, err := readHost(hostID)
	if err != nil {
		return nil, err
	}
	return host.AllocatedPorts, nil
}

func hostPath(hostID string) string {
	return filepath.Join("data", "host-"+hostID+".json")
}

func readHost(hostID string) (*Host, error) {
	data, err := os.ReadFile(hostPath(hostID))
	if err != nil {
		return nil, err
	}

	var host Host
	return &host, json.Unmarshal(data, &host)
}

func writeHost(hostID string, host *Host) error {
	data, err := json.Marshal(host)
	if err != nil {
		return err
	}

	return os.WriteFile(hostPath(hostID), data, 0644)
}

func acquireHostLock(hostID string, exclusive bool) (*flock.Flock, error) {
	if err := os.MkdirAll("data", 0755); err != nil {
		return nil, err
	}

	lockFile := filepath.Join("data", "host-"+hostID+".lock")
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

func releaseHostLock(lock *flock.Flock) error {
	return lock.Unlock()
}
