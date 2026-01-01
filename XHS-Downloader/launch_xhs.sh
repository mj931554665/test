#!/bin/bash
# Enter the directory where the script is located
cd "$(dirname "$0")"

# Execute main.py using the virtual environment's python directly
# This avoids issues with PATH or activation not working as expected
./xhs_env/bin/python main.py api
