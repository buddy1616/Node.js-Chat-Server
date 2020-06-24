var http = require("http");

var users = [];
var messages = [];
var serverPassword = 'admin';
var serverPort = '8081';
var timeoutInterval = 6000;
var pruneInterval = 600000;
var kickInterval = 300000;
var commArgs = process.argv.slice(2);
for (var i=0;i<commArgs.length;i++)
{
	if ((commArgs[i] == '-pass') && (commArgs.length > i+1)) { serverPassword = commArgs[i+1]; }
	else if ((commArgs[i] == '-port') && (commArgs.length > i+1)) { serverPort = commArgs[i+1]; }
	else if ((commArgs[i] == '-timeout') && (commArgs.length > i+1)) { timeoutInterval = commArgs[i+1]; }
	else if ((commArgs[i] == '-prune') && (commArgs.length > i+1)) { pruneInterval = commArgs[i+1]; }
	else if ((commArgs[i] == '-kick') && (commArgs.length > i+1)) { kickInterval = commArgs[i+1]; }
}

const ERROR_NOCONTENT = 'post content was blank';
const ERROR_NOAUTH = 'user or password incorrect';
const ERROR_NOCRED = 'must supply user id and password';
const ERROR_SERVERPASS = 'must supply server password';
const ERROR_WRONGPASS = 'incorrect password';
const ERROR_NOLOGOUT = 'user id not found, or password incorrect, could not be logged out';
const ERROR_BADREQUEST = 'invalid request';

http.createServer(function (request, response) {
	try
	{
		var args = [];
		if (request.url.substring(1) != '')
		{
			args = request.url.substring(1).split('/');
			for (var i=0;i<args.length;i++)
			{
				args[i] = decodeURIComponent(args[i]);
			}
		}
		if (args.length > 0)
		{
			response.writeHead(200, {'Content-Type': 'application/json'});
			var command = args[0].toLowerCase();
			switch (command)
			{
				case 'update': //0-update/1-userid/2-password
					if (args.length >= 3)
					{
						var u = auth(args[1], args[2]);
						if (u !== null)
						{
							response.end(jsonResponse(true, null, getUpdate(u), args));
						}
						else { response.end(jsonResponse(false, ERROR_NOAUTH, null, args)); }
					}
					else { response.end(jsonResponse(false, ERROR_NOCRED, null, args)); }
					break;
				case 'post': //0-post/1-userid/2-password/3-message/4-type[/5-touser]
					if (args.length >= 4)
					{
						var u = auth(args[1], args[2]);
						if (u !== null)
						{
							if (args[3] != '')
							{
								var newMess = new Message(u.idKey, null, htmlEncode(args[3]));
								if (args.length > 4)
								{
									switch (args[4])
									{
										case 'emote': newMess.isEmote = true; break;
										case 'image': newMess.isImage = true; break;
										case 'whisper':
											if (args.length > 5)
											{
												var tou = getUserById(args[5])
												if (tou !== null)
												{
													newMess.toUser = tou.idKey;
												}
												else
												{
													response.end(jsonResponse(false, 'user id not found', getUpdate(u), args));
													return;
												}
											}
											break;
									}
								}
								messages.push(newMess);
								u.lastPost = new Date();
								response.end(jsonResponse(true, null, getUpdate(u), args));
							}
							else
							{
								response.end(jsonResponse(false, ERROR_NOCONTENT, getUpdate(u), args));
							}
						}
						else { response.end(jsonResponse(false, ERROR_NOAUTH, null, args)); }
					}
					else { response.end(jsonResponse(false, 'must supply user and post content', null, args)); }
					break;
				case 'messages': getServerData(messages, args, response); break;
				case 'users': getServerData(users, args, response); break;
				case 'login': //0-login/1-handle/2-password
					if (args.length == 3)
					{
						for (var i=0;i<users.length;i++)
						{
							if (users[i].handle.toLowerCase() == args[1].toLowerCase())
							{
								var u = auth(users[i].idKey, args[2]);
								if (u !== null)
								{
									u.ipAddress = request.connection.remoteAddress;
									u.loggedIn = true;
									u.lastLogin = new Date();
									setTimeout(stayAlive, timeoutInterval, u);
									console.log(args[1].toLowerCase() + ' joined the chat with id: ' + u.idKey);
									response.end(jsonResponse(true, null, getUpdate(u), args));
								}
								else
								{
									response.end(jsonResponse(false, 'invalid handle and password', null, args));
								}
								return;
							}
						}
						var nu = new User(args[1].toLowerCase(), null, hash(args[1].toLowerCase()+'-'+args[2]), request.connection.remoteAddress, null, null);
						nu.loggedIn = true;
						nu.lastLogin = new Date();
						setTimeout(stayAlive, timeoutInterval, nu);
						users.push(nu);
						console.log(args[1].toLowerCase() + ' joined the chat with id: ' + nu.idKey);
						response.end(jsonResponse(true, null, getUpdate(nu), args));
					}
					else { response.end(jsonResponse(false, 'must supply user handle and passkey', null, args)); }
					break;
				case 'logout': //0-logout/1-userid/2-password|serverPassword
					if (args.length == 3)
					{
						for (var i=0;i<users.length;i++)
						{
							if (users[i].idKey == args[1])
							{
								var removeUser = false;
								var u = auth(args[1], args[2]);
								if (u !== null)
								{
									console.log(users[i].handle.toLowerCase() + ' left the chat (' + users[i].idKey + ')');
									response.end(jsonResponse(true, 'user logged out', null, args));
									removeUser = true;
								}

								if (!removeUser)
								{
									u = getUserById(args[1]);
									if ((u !== null) && (args[2] == serverPassword))
									{
										console.log(users[i].handle.toLowerCase() + ' was kicked from chat (' + users[i].idKey + ')');
										response.end(jsonResponse(true, 'user was kicked', null, args));
										removeUser = true;
									}
								}

								if (removeUser)
								{
									u.loggedIn = false;
								}

								return;
							}
						}
						response.end(jsonResponse(false, ERROR_NOLOGOUT, null, args));
					}
					else { response.end(jsonResponse(false, 'must supply user id key', null, args)); }
					break;
				case 'quit':
					console.log('Quitting.');
					response.end(jsonResponse(true, 'Goodbye', null, args));
					process.exit(0);
					break;
				default:
					response.end(jsonResponse(false, ERROR_BADREQUEST, null, args));
					break;
			}
		}
		else
		{
			var fs = require('fs');			
			fs.readFile('chat.html', function(err, data){
					response.writeHead(200, {'Content-Type': 'text/html'});
					response.end(data);
				});
		}
	}
	catch(e)
	{
		console.log('Error:\n' + e);
		response.end();
		process.exit(1);
	}

}).listen(serverPort);

setInterval(prune, pruneInterval);
setInterval(kick, kickInterval);
console.log('Listening on port: ' + serverPort + '.');

function stayAlive(u)
{
	if ((new Date()).getTime() - u.lastUpdate.getTime() > timeoutInterval)
	{
		u.loggedIn = false;
		console.log(u.handle.toLowerCase() + ' was disconnected from chat (' + u.idKey + ')');
		return;
	}
	setTimeout(stayAlive, timeoutInterval, u);
}
function prune()
{
	var t = (new Date()).getTime();
	for (var i=messages.length-1;i>=0;i--)
	{
		if (t - messages[i].timestamp.getTime() > pruneInterval)
		{
			messages.splice(i, 1);
		}
	}
}
function kick()
{
	for (var i=0;i<users.length;i++)
	{
		if ((new Date()).getTime() - users[i].lastPost.getTime() > kickInterval)
		{
			users[i].loggedIn = false;
			console.log(users[i].handle.toLowerCase() + ' was kicked from chat due to inactivity (' + users[i].idKey + ')');
		}
	}
}

function htmlEncode(s)
{
	var r = s.replace(/&/g, '&amp;');
	r = r.replace(/</g, '&lt;');
	r = r.replace(/>/g, '&gt;');
	r = r.replace(/'/g, '&#39;');
	return r.replace(/"/g, '&quot;');
}

function getUpdate(u)
{
	var r = {};
	r.newMessages = getNewMessages(u);

	var us = [];
	for (var i=0;i<users.length;i++)
	{
		if (users[i].loggedIn) { us.push({handle:users[i].handle, idKey:users[i].idKey, isNew:((users[i].lastLogin.getTime() > u.lastLogin.getTime()) ? true : false)}); }
	}
	us.sort((a, b) => (a.handle.toLowerCase() > b.handle.toLowerCase()) ? 1 : -1);
	r.userList = us;
	r.idKey = u.idKey;
	r.handle = u.handle.toLowerCase();
	u.lastUpdate = new Date();
	return r;
}

function getServerData(obj, args, response)
{
	if (args.length >= 1)
	{
		if (args[1] == serverPassword)
		{
			response.end(jsonResponse(true, null, obj, args));
		}
		else { response.end(jsonResponse(false, ERROR_WRONGPASS, null, args)); }
	}
	else { response.end(jsonResponse(false, ERROR_SERVERPASS, null, args)); }
}

function Response(succ, mess, obj, args)
{
	return {
		success: succ,
		messages: mess,
		data: obj,
		arguments: args,
	};
}

function jsonResponse(succ, mess, obj, args)
{
	return JSON.stringify(new Response(succ, mess, obj, args));
}

function User(nick, id, pass, ip, time, last)
{
	return {
		handle: nick.toLowerCase(),
		idKey: (id !== null) ? id : Buffer.from(nick + (Math.random()*10)).toString('base64').replace(/=/g, ''),
		passKey: pass,
		ipAddress: ip,
		joinTime: (time !== null) ? time : new Date(),
		lastLogin: (time !== null) ? time : new Date(),
		lastUpdate: (last !== null) ? last : new Date(),
		lastPost: new Date(),
		isMod: false,
		loggedIn : false,
	};
}

function getUserById(id)
{
	for (var i=0;i<users.length;i++)
	{
		if (users[i].idKey == id) { return users[i]; }
	}
	return null;
}

function auth(id, pass)
{
	var r = getUserById(id);
	if ((r !== null) && (hash(r.handle.toLowerCase()+'-'+pass) == r.passKey))
	{
		return r;
	}
	return null;
}

function Message(from, time, mess)
{
	return {
		fromUser: from,
		timestamp: (time !== null) ? time : new Date(),
		contents: mess,
		toUser: null,
		isEmote: false,
		isImage: false,
	};
}

function getNewMessages(u)
{
	var r = [];
	for (var i=0;i<messages.length;i++)
	{
		if ((messages[i].timestamp.getTime() > u.lastUpdate.getTime())
			&& ((messages[i].toUser === null)
				|| (messages[i].toUser == u.idKey)
				|| (messages[i].fromUser == u.idKey)))
		{
			r.push(messages[i]);
		}
	}
	return r;
}

function hash(str)
{
	var b64 = Buffer.from(str).toString('base64').replace(/\W/g, '');
	var n = '';
	for (var i=0;i<b64.length;i++)
	{
		var bin = b64.charCodeAt(i).toString(2);
		var tot = '';
		for (var q=0;q<bin.length;q++)
		{
			tot += (bin.charAt(q) == 1) ? 0 : 1;
		}
		n += parseInt(tot, 2);
	}
	var r = '';
	for (var i=0;i<n.length;i+=3)
	{
		r += parseInt(n.substring(i, i + 2)).toString(16);
	}
	return r;
}