#!/bin/bash

case "$1" in
  up)
    docker compose up -d
    ;;
  down)
    docker compose down
    ;;
  restart)
    docker compose down
    docker compose up -d
    ;;
  *)
    echo "Usage: $0 {up|down|restart}"
    exit 1
    ;;
esac

