#!/bin/bash
# Usage: ./move_nic.sh <container_name> <host_nic>

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <container_name> <host_nic>"
  exit 1
fi

CONTAINER_NAME="$1"
HOST_NIC="$2"

# Wait for the container to be up and retrieve its PID.
MAX_CONTAINER_WAIT=15  # Maximum seconds to wait for container startup
WAITED_CONTAINER=0
echo "Waiting for container '$CONTAINER_NAME' to be up..."
while true; do
  CONTAINER_PID=$(podman inspect --format '{{.State.Pid}}' "$CONTAINER_NAME" 2>/dev/null)
  if [ -n "$CONTAINER_PID" ] && [ "$CONTAINER_PID" -gt 0 ]; then
    break
  fi
  sleep 1
  WAITED_CONTAINER=$((WAITED_CONTAINER+1))
  if [ $WAITED_CONTAINER -ge $MAX_CONTAINER_WAIT ]; then
    echo "Error: Container '$CONTAINER_NAME' did not start within $MAX_CONTAINER_WAIT seconds."
    exit 1
  fi
done

echo "Container '$CONTAINER_NAME' is running with PID $CONTAINER_PID."

# Wait for the host NIC to become available.
MAX_NIC_WAIT=15  # Maximum seconds to wait for NIC availability
WAITED_NIC=0
echo "Waiting for interface '$HOST_NIC' to become available..."
while ! ip link show "$HOST_NIC" &> /dev/null; do
  sleep 1
  WAITED_NIC=$((WAITED_NIC+1))
  if [ $WAITED_NIC -ge $MAX_NIC_WAIT ]; then
    echo "Error: Interface '$HOST_NIC' did not become available within $MAX_NIC_WAIT seconds."
    exit 1
  fi
done

echo "Interface '$HOST_NIC' is now available."

# Capture the current IP addresses of the interface.
IP4=$(ip -4 addr show "$HOST_NIC" | awk '/inet / {print $2; exit}')

echo "Captured IP configuration:"
[ -n "$IP4" ] && echo "  IPv4: $IP4" || echo "  No IPv4 address found."
# Nebula does not use IPv6 for overlay, ignore it

# Move the NIC into the container's network namespace.
echo "Moving interface '$HOST_NIC' to container's network namespace..."
ip link set "$HOST_NIC" netns "$CONTAINER_PID"
if [ $? -ne 0 ]; then
  echo "Failed to move interface '$HOST_NIC' to the container namespace."
  exit 1
fi

# Reapply the saved IP addresses inside the container's network namespace using nsenter.
echo "Reapplying IP configuration in the container's namespace..."
if [ -n "$IP4" ]; then
  nsenter --net=/proc/"$CONTAINER_PID"/ns/net ip addr add "$IP4" dev "$HOST_NIC"
  if [ $? -ne 0 ]; then
    echo "Failed to reassign IPv4 address $IP4 to interface '$HOST_NIC'."
  else
    echo "IPv4 address $IP4 reassigned."
  fi
fi

# Bring the interface up in the container's network namespace.
nsenter --net=/proc/"$CONTAINER_PID"/ns/net ip link set "$HOST_NIC" up

echo "Interface '$HOST_NIC' successfully moved and configured in container '$CONTAINER_NAME'."
