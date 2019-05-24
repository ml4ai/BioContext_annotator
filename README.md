Big Mech Context Annotation Web App
===================================
This README presents the step-by-step instructions for starting the web-app for BioContext Annotator. 

There are 4 main steps: 
    1. Setting up the working environment
    2. Running Reach on the papers that you want to view through the app
    3. Setting up PostgreSQL user account and database
    4. Loading the dictionaries and data table for each paper and starting the server
    
#### Setting up the working environment

To run the app, set up a Python 3.6 virtualenv in the `venv` subfolder with the prerequisites in `requirements.txt`.


#### Running Reach
Please run Reach on the papers of your choosing, and ensure to copy the following three files into server/data/papers: mention_intervals.txt, event_intervals.txt and sentences.txt
In addition to these three files, you will need a tsv file for the annotations, a sections.txt file and a titles.txt file. These additional files have to exist in the directory of each paper, even if the contents may be empty. 
For your convenience, the required files have been kept in server/data/papers/PMC2910130. Please copy the files into other papers. 
Therefore, for each paper, we must have the following files:
    a) sentences.txt 
    b) mention_intervals.txt
    c) event_intervals.txt
    d) annotated_event_intervals.tsv
    e) sections.txt
    f) titles.txt

#### Setting up PostgreSQL
Start by creating a new owner and ensure that the owner has SUPERUSER privileges.
Mac users, please refer to: https://www.codementor.io/engineerapart/getting-started-with-postgresql-on-mac-osx-are8jcopb <br>
Windows users: https://www.microfocus.com/documentation/idol/IDOL_12_0/MediaServer/Guides/html/English/Content/Getting_Started/Configure/_TRN_Set_up_PostgreSQL.htm <br>
Linux users: https://www.techrepublic.com/blog/diy-it-guy/diy-a-postgresql-database-server-setup-anyone-can-handle/


This branch tracks the development version of the server. It listens for Websocket connections on port 8090, and uses the `context_devel` database. These settings can be modified in app/config.py
