#!/bin/sh
./bin/run-common.sh
./manage.py loaddata fixtures/initial_data_dev.json

# Try running this in a loop, so that the whole container doesn't exit when
# runserver reloads and hits an error
while [ 1 ]; do
    ./manage.py runsslserver
    sleep 1
done
