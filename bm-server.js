process.title = 'bm-server';
var webSocketServer = require('websocket').server;
var http = require('http');

// if a port number is passedinto the command, use that, else default to 1337
var port = (process.argv[2]||"").trim() || 1337;

var sessions = {};

var server = http.createServer(function(request, response){});
server.listen(port, function(){
	console.log(`Server active on port ${port}`);
});

var wsServer = new webSocketServer({
	httpServer: server
});

wsServer.on('request', function (request) {
	var connection = request.accept(null, request.origin);	
	var role, session, index;
	
	const broadcastSessionUpdate = (msg)=>{
		[session.master, ...session.slaves].forEach(con=>{
			if(!con) return;
			con.sendUTF(JSON.stringify({
				action: 'session_update', 
				slaves: session.slaves.length,
				members: session.master ? session.slaves.length+1 : session.slaves.length,
				session_id: session.id,
				started: session.started,
				message: msg || ""
			}));
		});
	};
	
	connection.on('message', function (message) {
		var data = JSON.parse(message.utf8Data);
		switch(data.action){
			case "init_session":
				if(data.role === 'master'){
					if(!sessions[data.sessionid]) sessions[data.sessionid] = {id: data.sessionid, master: null, slaves:[], started: false};
					session = sessions[data.sessionid];
					if(!!session.master){
						connection.sendUTF(JSON.stringify({
							action: 'session_error', 
							message: 'There is already a master assigned for this session.'
						}));
					}
					
					session.master = connection;
					role = 'master';
					
					broadcastSessionUpdate('Leader has joined session.');
					
				}else{
					
					if(!sessions[data.sessionid]){
						connection.sendUTF(JSON.stringify({
							action: 'session_error', 
							message: 'This session has already ended.'
						}));
						return;
					}
					
					session = sessions[data.sessionid];
					if(session.started){
						connection.sendUTF(JSON.stringify({
							action: 'session_error', 
							message: 'This session has already started. It\'s too late to join.'
						}));
					}
				
					index = session.slaves.length;
					session.slaves.push(connection);
					role = 'slave';
					
					broadcastSessionUpdate('Member has joined session.');
				}
				console.log(`${role} joined session: ${data.sessionid}`);
				break;
			case "set_state":
				if(role !== 'master') break;
				session.slaves.forEach(slave=>{
					if(null === slave) return;
					slave.sendUTF(JSON.stringify({
						action: 'set_state', 
						state: data.state
					}));
				});
				break;
				
			case "start_session":
				session.started = true;
				broadcastSessionUpdate('Session has started.');
				break;
		}
	});
	
	connection.on('close', function(connection){
		if(role == 'slave'){
			session.slaves[index] = null;
			broadcastSessionUpdate('Member has left session.');
			console.log(`${role} #${index} left session: ${session.id}`);
		}else{
			session.master = null;
			session.slaves.forEach(slave=>{
				if(null === slave) return;
				slave.sendUTF(JSON.stringify({
					action: 'session_error', 
					message: 'This session has ended.'
				}));
			});
			console.log(`${role} left session: ${session.id}`);
			console.log(`${session.id} has ended`);
			delete sessions[session.id];
		}
	});
	
});