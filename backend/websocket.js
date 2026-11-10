/**
 * WebSocket Server for Real-time Collaborative Code Editor
 * Provides real-time synchronization using a simple broadcast approach
 */

const WebSocket = require('ws');

/**
 * Create WebSocket server for collaborative editing and quiz polling
 * @param {http.Server} httpServer - HTTP server instance
 * @returns {WebSocket.Server} WebSocket server instance
 */
function createWebSocketServer(httpServer) {
    const wss = new WebSocket.Server({
        server: httpServer,
        path: '/ws'
    });

    // Store rooms and their clients
    const rooms = new Map();

    // Store current code state per room
    const roomCode = new Map();

    // Store active polls per room
    const activePolls = new Map();

    // Store poll answers per room
    const pollAnswers = new Map();

    // Store fastest correct respondents per room
    const fastestResponders = new Map();

    wss.on('connection', (ws, req) => {
        // Parse URL to get room name
        const url = new URL(req.url, `http://${req.headers.host}`);
        const roomName = url.searchParams.get('room') || 'code-editor-room';
        const clientId = 'client_' + Math.random().toString(36).substr(2, 9);
        const uid = url.searchParams.get('uid');
        const role = url.searchParams.get('role') || 'student';

        ws.clientId = clientId;
        ws.roomName = roomName;
        ws.isAlive = true;
        ws.clientName = 'Anonymous';
        ws.clientLanguage = 'javascript';
        ws.uid = uid;
        ws.role = role;

        // Initialize room if not exists
        if (!rooms.has(roomName)) {
            rooms.set(roomName, new Set());
            roomCode.set(roomName, '// Welcome to Virtual Classroom Code Editor!\n// Start coding here...\n');
            activePolls.set(roomName, null);
            pollAnswers.set(roomName, {});
            fastestResponders.set(roomName, {});
        }

        const room = rooms.get(roomName);
        room.add(ws);

        // Send initial state to new client
        ws.send(JSON.stringify({
            type: 'init',
            clientId: clientId,
            name: ws.clientName,
            code: roomCode.get(roomName) || '',
            uid: uid,
            role: role
        }));

        // Broadcast new client to room
        broadcastToRoom(ws, roomName, {
            type: 'user-joined',
            clientId: clientId,
            name: ws.clientName,
            uid: uid,
            role: role
        }, room);

        // Handle messages
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());

                switch (data.type) {
                    case 'join':
                        // Update client info
                        ws.clientName = data.name || ws.clientName;
                        ws.clientLanguage = data.language || ws.clientLanguage;
                        ws.uid = data.uid || ws.uid;
                        ws.role = data.role || ws.role;

                        // Broadcast join to other clients
                        broadcastToRoom(ws, roomName, {
                            type: 'user-joined',
                            clientId: clientId,
                            name: ws.clientName,
                            uid: ws.uid,
                            role: ws.role
                        }, room);
                        break;

                    case 'code':
                        // Update code state and broadcast to others
                        roomCode.set(roomName, data.code);
                        broadcastToRoom(ws, roomName, {
                            type: 'code-updated',
                            clientId: clientId,
                            code: data.code
                        }, room);
                        break;

                    case 'cursor':
                        // Broadcast cursor position to others
                        broadcastToRoom(ws, roomName, {
                            type: 'cursor-updated',
                            clientId: clientId,
                            position: data.position,
                            selection: data.selection,
                            name: ws.clientName
                        }, room);
                        break;

                    case 'poll-start':
                        // Start a poll broadcast
                        handlePollStart(ws, roomName, data, room);
                        break;

                    case 'poll-answer':
                        // Submit an answer
                        handlePollAnswer(ws, roomName, data, room);
                        break;

                    case 'poll-submit':
                        // Final poll submission
                        handlePollSubmit(ws, roomName, data, room);
                        break;

                    case 'poll-results':
                        // Request for poll results
                        sendPollResults(ws, roomName, data);
                        break;

                    case 'poll-end':
                        // End a poll
                        handlePollEnd(ws, roomName, data, room);
                        break;

                    case 'ping':
                        ws.pong();
                        break;
                }
            } catch (e) {
                // Silently handle malformed messages to prevent client disruption
            }
        });

        // Handle ping/pong
        ws.on('pong', () => {
            ws.isAlive = true;
        });

        // Handle disconnect
        ws.on('close', () => {
            if (room && room.has(ws)) {
                room.delete(ws);

                // Notify others
                broadcastToRoom(ws, roomName, {
                    type: 'user-left',
                    clientId: clientId,
                    uid: ws.uid
                }, room);
            }
        });
    });

    // Ping clients periodically to check connection
    setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    /**
     * Handle poll start from instructor
     */
    function handlePollStart(ws, roomName, data, room) {
        const pollId = data.pollId;
        const quizId = data.quizId;
        const questions = data.questions;
        const timeLimit = data.timeLimit || 30; // default 30 seconds

        // Store poll state
        activePolls.set(roomName, {
            pollId,
            quizId,
            questions,
            startTime: new Date(),
            endTime: new Date(Date.now() + timeLimit * 1000),
            timeLimit,
            answers: {},
            fastestResponders: {}
        });

        // Initialize answers storage
        pollAnswers.set(roomName, {});
        fastestResponders.set(roomName, {});

        // Broadcast poll start to all students in the room
        broadcastToRoom(ws, roomName, {
            type: 'poll-started',
            pollId,
            quizId,
            quizTitle: data.quizTitle || `Quiz ${quizId}`,
            questions,
            timeLimit,
            startTime: new Date().toISOString()
        }, room);
    }

    /**
     * Handle poll answer submission
     */
    function handlePollAnswer(ws, roomName, data, room) {
        const { pollId, questionId, selectedOption } = data;
        const uid = ws.uid;

        if (!uid) return;

        const pollState = activePolls.get(roomName);
        if (!pollState || pollState.pollId !== pollId) return;

        // Store answer
        if (!pollState.answers[uid]) {
            pollState.answers[uid] = {};
        }
        pollState.answers[uid][questionId] = selectedOption;

        // Update fastest responders (only for correct answers)
        const question = pollState.questions.find(q => q.id === questionId);
        if (question && question.correct === selectedOption) {
            const now = Date.now();
            if (!pollState.fastestResponders[uid] ||
                (now - pollState.startTime.getTime()) <
                (new Date(pollState.fastestResponders[uid].time)).getTime()) {
                pollState.fastestResponders[uid] = {
                    questionId,
                    time: new Date()
                };
            }
        }

        // Broadcast updated results to instructor
        broadcastResults(ws, roomName, data, room);
    }

    /**
     * Handle final poll submission
     */
    function handlePollSubmit(ws, roomName, data, room) {
        const { pollId, answers } = data;
        const uid = ws.uid;

        if (!uid) return;

        const pollState = activePolls.get(roomName);
        if (!pollState || pollState.pollId !== pollId) return;

        // Store final answers
        if (!pollState.answers[uid]) {
            pollState.answers[uid] = {};
        }
        Object.assign(pollState.answers[uid], answers);

        // Calculate final results
        const results = calculateResults(pollState);

        // Broadcast final results
        broadcastToRoom(ws, roomName, {
            type: 'poll-results',
            pollId,
            results,
            fastestResponders: getTopFastestResponders(pollState.fastestResponders, 5)
        }, room);
    }

    /**
     * Handle poll end
     */
    function handlePollEnd(ws, roomName, data, room) {
        const pollState = activePolls.get(roomName);
        if (!pollState) return;

        const results = calculateResults(pollState);

        // Reset poll state
        activePolls.set(roomName, null);
        pollAnswers.set(roomName, {});

        // Broadcast final results to all
        broadcastToRoom(ws, roomName, {
            type: 'poll-ended',
            pollId: pollState.pollId,
            results,
            fastestResponders: getTopFastestResponders(pollState.fastestResponders, 5),
            timestamp: new Date().toISOString()
        }, room);
    }

    /**
     * Broadcast real-time results
     */
    function broadcastResults(senderWs, roomName, data, room) {
        const pollState = activePolls.get(roomName);
        if (!pollState) return;

        const results = calculateResults(pollState);

        // Send update to instructor (or all if no specific instructor)
        broadcastToRoom(senderWs, roomName, {
            type: 'poll-update',
            pollId: data.pollId,
            questionId: data.questionId,
            selectedOption: data.selectedOption,
            results
        }, room);
    }

    /**
     * Send poll results on request
     */
    function sendPollResults(ws, roomName, data) {
        const pollState = activePolls.get(roomName);
        if (!pollState) return;

        const results = calculateResults(pollState);

        ws.send(JSON.stringify({
            type: 'poll-results',
            pollId: data.pollId,
            results,
            fastestResponders: getTopFastestResponders(pollState.fastestResponders, 5)
        }));
    }

    /**
     * Calculate poll results
     */
    function calculateResults(pollState) {
        const results = {};
        const studentIds = Object.keys(pollState.answers);

        // Initialize results for each question
        pollState.questions.forEach(q => {
            results[q.id] = {
                question: q.question,
                options: {
                    A: { count: 0, percentage: 0 },
                    B: { count: 0, percentage: 0 },
                    C: { count: 0, percentage: 0 },
                    D: { count: 0, percentage: 0 }
                },
                totalResponses: studentIds.length
            };
        });

        // Count answers
        studentIds.forEach(uid => {
            Object.entries(pollState.answers[uid]).forEach(([qid, answer]) => {
                if (results[qid] && results[qid].options[answer] !== undefined) {
                    results[qid].options[answer].count++;
                }
            });
        });

        // Calculate percentages
        Object.entries(results).forEach(([qid, result]) => {
            const total = result.totalResponses;
            if (total > 0) {
                Object.keys(result.options).forEach(opt => {
                    result.options[opt].percentage = Math.round((result.options[opt].count / total) * 100);
                });
            }
        });

        return results;
    }

    /**
     * Get top fastest correct responders
     */
    function getTopFastestResponders(fastestResponders, limit) {
        const responders = Object.entries(fastestResponders).map(([uid, data]) => ({
            uid,
            questionId: data.questionId,
            time: data.time
        }));

        // Sort by time (ascending) and take top N
        responders.sort((a, b) => a.time - b.time);
        return responders.slice(0, limit);
    }

    // Get room info for debugging
    function getRoomInfo() {
        const info = {};
        for (const [roomName, clients] of rooms.entries()) {
            info[roomName] = {
                clientCount: clients.size,
                hasActivePoll: activePolls.get(roomName) !== null
            };
        }
        return info;
    }

    // Get current code for a room
    function getCode(roomName) {
        return roomCode.get(roomName) || '// Welcome to Virtual Classroom Code Editor!';
    }

    // Set code for a room
    function setCode(roomName, newCode) {
        roomCode.set(roomName, newCode);
    }

    // Expose functions
    wss.getRoomInfo = getRoomInfo;
    wss.getCode = getCode;
    wss.setCode = setCode;
    wss.getActivePoll = (roomName) => activePolls.get(roomName);
    wss.pollAnswer = (roomName, pollId, uid, answers) => {
        const pollState = activePolls.get(roomName);
        if (pollState && pollState.pollId === pollId) {
            Object.assign(pollState.answers[uid] || {}, answers);
            return true;
        }
        return false;
    };

    return wss;
}

/**
 * Broadcast message to all clients in a room (excluding sender)
 */
function broadcastToRoom(senderWs, roomName, data, room) {
    if (!room) return;

    const message = JSON.stringify(data);
    room.forEach((clientWs) => {
        if (clientWs !== senderWs && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(message);
        }
    });
}

module.exports = {
    createWebSocketServer
};