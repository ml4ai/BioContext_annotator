Big Mech Context Annotation Web App
===================================

To run the server, set up a Python 3.4 virtualenv in the `virtualenv` subfolder with the prerequisites in `requirements.txt`.

The appropriate script (Linux/OS X: `start-server`, Windows: `start-server.bat`) can then be used to start the server.

By default, the server will start listening for Websocket connections on port 8085, and will attempt to connect to a PostgreSQL server on `127.0.0.1:5432` as the `context` user with no password.  The defaults may be changed in `app/config.py`.

PostgreSQL Configuration
------------------------

Start by creating an empty database with any owner. (The application will create a new login role with the appropriate permissions later.)

Ensure that the database configuration options in `app/config.py` are correct. In particular, be sure to set `db_vars["postgres_login"]` to the name of the login role you would like the application to create.

Start the server in console-only mode, connecting to the newly created database as a superuser (e.g., `start-server -postgres postgres@127.0.0.1:5432/context --console`)

When the console is up, run `self.provider._create_tables()`, then `exit()`.

Optionally, run `self.provider._load_grounding_dictionaries()` to load the default free text -> grounding ID associations, and run `self.provider._load_all_papers()` to also load all the default paper data.

**This branch tracks the development version of the server.** It listens for Websocket connections on port 8090, and uses the `context_devel` database.
