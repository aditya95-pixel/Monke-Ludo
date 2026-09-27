require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

const COLOR_CONFIGS = {
    2: ['red', 'yellow'],
    3: ['red', 'green', 'yellow'],
    4: ['red', 'green', 'yellow', 'blue']
};

io.on('connection', (socket) => {
    console.log(`Player Connected: ${socket.id}`);

    // Join Room
    socket.on('joinRoom', ({ roomId, playerName, maxPlayers }) => {
        if (!roomId) return socket.emit('errorMsg', 'Room ID is required.');

        if (!rooms[roomId]) {
            const parsedMax = parseInt(maxPlayers, 10);
            const validMax = (parsedMax >= 2 && parsedMax <= 4) ? parsedMax : 4;

            rooms[roomId] = {
                id: roomId,
                maxPlayers: validMax,
                players: [],
                gameStarted: false,
                currentTurnIndex: 0,
                turnColors: [],
                lastRoll: null,
                hasRolled: false
            };
        }

        const room = rooms[roomId];
        if (room.gameStarted) return socket.emit('errorMsg', 'Game has already started in this room.');
        if (room.players.length >= room.maxPlayers) return socket.emit('errorMsg', 'Room is full.');

        const availableColors = COLOR_CONFIGS[room.maxPlayers] || COLOR_CONFIGS[4];
        const assignedColor = availableColors[room.players.length];

        const playerObj = {
            id: socket.id,
            name: playerName || `Player ${room.players.length + 1}`,
            color: assignedColor
        };

        room.players.push(playerObj);
        socket.join(roomId);

        socket.emit('playerAssigned', { player: playerObj, maxPlayers: room.maxPlayers, roomId });
        io.to(roomId).emit('roomUpdate', { players: room.players, maxPlayers: room.maxPlayers });

        if (room.players.length === room.maxPlayers) {
            room.gameStarted = true;
            room.turnColors = room.players.map(p => p.color);
            io.to(roomId).emit('startGame', {
                activeColors: room.turnColors,
                currentTurn: room.turnColors[room.currentTurnIndex]
            });
        }
    });

    // Synchronized Dice Roll
    socket.on('rollDice', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;

        const currentTurnColor = room.turnColors[room.currentTurnIndex];
        const player = room.players.find(p => p.id === socket.id);

        if (player && player.color === currentTurnColor && !room.hasRolled) {
            const rollValue = Math.floor(Math.random() * 6) + 1;
            room.lastRoll = rollValue;
            room.hasRolled = true;

            io.to(roomId).emit('diceRolled', { color: currentTurnColor, rollValue });
        }
    });

    // Synchronized Token Movement
    socket.on('moveToken', ({ roomId, tokenIdx }) => {
        const room = rooms[roomId];
        if (!room || !room.gameStarted || !room.hasRolled) return;

        const currentTurnColor = room.turnColors[room.currentTurnIndex];
        const player = room.players.find(p => p.id === socket.id);

        if (player && player.color === currentTurnColor) {
            io.to(roomId).emit('tokenMoved', {
                color: currentTurnColor,
                tokenIdx,
                rollValue: room.lastRoll
            });
            room.hasRolled = false;
        }
    });

    // Pass Turn
    socket.on('turnEnded', ({ roomId, getsBonusRoll }) => {
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;

        room.hasRolled = false;

        if (!getsBonusRoll) {
            room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnColors.length;
        }

        io.to(roomId).emit('nextTurn', { currentTurn: room.turnColors[room.currentTurnIndex] });
    });

    // Handle Game Over
    socket.on('gameOver', ({ roomId, winnerColor, winnerName }) => {
        const room = rooms[roomId];
        if (room) {
            room.gameStarted = false;
            io.to(roomId).emit('announceWinner', { winnerColor, winnerName });
        }
    });

    // Disconnect Handler
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const idx = room.players.findIndex(p => p.id === socket.id);

            if (idx !== -1) {
                const disconnectedPlayer = room.players[idx];
                room.players.splice(idx, 1);

                if (room.gameStarted) {
                    const colorIdx = room.turnColors.indexOf(disconnectedPlayer.color);
                    if (colorIdx !== -1) {
                        room.turnColors.splice(colorIdx, 1);
                        if (room.turnColors.length > 0) {
                            room.currentTurnIndex %= room.turnColors.length;
                            io.to(roomId).emit('nextTurn', { currentTurn: room.turnColors[room.currentTurnIndex] });
                        }
                    }
                } else {
                    io.to(roomId).emit('roomUpdate', { players: room.players, maxPlayers: room.maxPlayers });
                }

                if (room.players.length === 0) {
                    delete rooms[roomId];
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});