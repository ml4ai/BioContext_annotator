Big Mech Context Annotation Web App
===================================
This README presents the step-by-step instructions for starting the web-app for BioContext Annotator in a PyCharm setting. Pycharm serves a built-in web server that eliminates the additional step of having to set up a web server. The following set of instructions are best run on Pycharm, since it does not discuss the step of setting up the server. However, this code can be run if you set up an Apache instance or any other web server of your choice.  

There are 4 main steps: 
    1. Setting up the working environment
    2. Running Reach on the papers that you want to view through the app
    3. Setting up PostgreSQL user account and database
    4. Loading the grounding dictionaries and data table for each paper and starting the server
    
#### Setting up the working environment

To run the app, set up a Python 3.6 virtualenv in the `venv` subfolder with the prerequisites in `requirements.txt`.


#### Running Reach
Please run Reach on the papers of your choosing, and ensure to copy the resultant three files into server/data/papers: mention_intervals.txt, event_intervals.txt and sentences.txt
In addition to these three files, you will need a tsv file for the annotations, a sections.txt file and a titles.txt file. These additional files have to exist in the directory of each paper, even if the contents may be empty. 
For your convenience, the required files have been kept in server/data/papers/PMC2910130. Please copy the files into other papers. 
Therefore, for each paper, we must have the following files: <br>
    a) sentences.txt <br>
    b) mention_intervals.txt <br>
    c) event_intervals.txt <br>
    d) annotated_event_intervals.tsv <br>
    e) sections.txt <br>
    f) titles.txt <br>

#### Setting up PostgreSQL
Start by creating a new owner and ensure that the owner has SUPERUSER privileges.
<br>Mac users, please refer to: https://www.codementor.io/engineerapart/getting-started-with-postgresql-on-mac-osx-are8jcopb <br>
Windows users: https://www.microfocus.com/documentation/idol/IDOL_12_0/MediaServer/Guides/html/English/Content/Getting_Started/Configure/_TRN_Set_up_PostgreSQL.htm <br>
Linux users: https://www.techrepublic.com/blog/diy-it-guy/diy-a-postgresql-database-server-setup-anyone-can-handle/

<br> Once your user is created, create a database by logging into that user. 
Once your database has been created successfully, your terminal should echo the message "CREATE DATABASE"

This branch tracks the development version of the server. It listens for Websocket connections on port 8090, and uses the `context_devel` database. These settings can be modified in app/config.py

#### Loading dictionaries and datatables for each paper
It is now time to create the datatables, load the grounding dictionary and start the server.
<br>First, cd into the server directory
<br>Type the following into the terminal: ./start-server -postgres thumsi_context:thumsi_context@127.0.0.1:5432/thumsi_context_devel --console
The format is user:password@host:port/dbname. <br>
This will connect to the database and open a python terminal. We have to create the data tables, load the grounding dictionary, and load the papers. For this, copy the following three commands to the python console in order:
<br> 1. self.provider._create_tables()
<br> 2. self.provider._load_grounding_dictionaries()
<br> 3. self.provider._load_all_papers()
<br> Step 3 should not yield any AssertionErrors. If it does, it means we need to add some missing grounding information to the server/app/providers/postgresql.py file. This can be done in line 1148 onwards. There are some related examples specified in the file.
Once the papers have been loaded, the last step is to start the web server. If you run the code on Pycharm, a web server is started for you upon running the main script. If not, you may want to start an Apache server.
To start the main script, open a new terminal in PyCharm and type the following, in the BioContext_annotator/server directory: python3 main.py -postgres "thumsi_context:thumsi_context@127.0.0.1:5432/thumsi_context_devel" -w "8090"
Once you open the index.html on any browser, you should get a success message that a connection to the server has been established, and the python terminal should echo a similar message: <br>
[2019-05-24 11:44:21] [INFO] [::1] [SEND] {"id": 0, "command": "get_paper_list", "data": {"draw": 1, "recordsTotal": 14, "...
<br> This line confirms that your set up is complete and you are now ready to use the annotator web tool.