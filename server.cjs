var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_vite = require("vite");
var import_socket = require("socket.io");
var import_http = __toESM(require("http"), 1);
var import_path = __toESM(require("path"), 1);
var import_uuid = require("uuid");
var app = (0, import_express.default)();
var server = import_http.default.createServer(app);
var io = new import_socket.Server(server, {
  cors: { origin: "*" }
});
var PORT = 3e3;
var SUITS = ["hearts", "diamonds", "clubs", "spades"];
var RANKS_36 = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"];
var RANKS_24 = ["9", "10", "J", "Q", "K", "A"];
var RANKS_52 = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
var RANK_VALUES = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  "J": 11,
  "Q": 12,
  "K": 13,
  "A": 14
};
function createDeck(size) {
  const deck = [];
  const ranks = size === 24 ? RANKS_24 : size === 36 ? RANKS_36 : RANKS_52;
  for (const suit of SUITS) {
    for (const rank of ranks) {
      deck.push({ id: `${rank}_of_${suit}_${(0, import_uuid.v4)()}`, suit, rank, value: RANK_VALUES[rank] });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}
var rooms = /* @__PURE__ */ new Map();
function getRoom(roomId) {
  return rooms.get(roomId);
}
function broadcastRoomState(roomId) {
  const room = getRoom(roomId);
  if (!room) return;
  const publicState = {
    roomId: room.roomId,
    hostId: room.hostId,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isBot: p.isBot,
      handSize: p.hand.length,
      connected: p.connected,
      cheatPenaltyTurns: p.cheatPenaltyTurns
    })),
    status: room.status,
    deckSize: room.deck.length,
    trumpCard: room.trumpCard,
    trumpSuit: room.trumpSuit,
    discardSize: room.discardPile.length,
    table: room.table,
    attackerId: room.attackerId,
    defenderId: room.defenderId,
    turnPhase: room.turnPhase,
    winnerId: room.winnerId,
    messages: room.messages,
    settings: room.settings,
    turnStartTime: room.turnStartTime
  };
  io.to(roomId).emit("room_state", publicState);
  room.players.forEach((p) => {
    if (!p.isBot && p.socketId) {
      io.to(p.socketId).emit("hand_update", p.hand);
    }
  });
}
function getNextPlayer(room, currentIndex) {
  let next = (currentIndex + 1) % room.players.length;
  while (room.players[next].hand.length === 0 && room.deck.length === 0) {
    next = (next + 1) % room.players.length;
    if (next === currentIndex) break;
  }
  return next;
}
function replenishHands(room) {
  const attackerIndex = room.players.findIndex((p) => p.id === room.attackerId);
  const defenderIndex = room.players.findIndex((p) => p.id === room.defenderId);
  const order = [attackerIndex];
  for (let i = 1; i < room.players.length; i++) {
    const idx = (attackerIndex + i) % room.players.length;
    if (idx !== defenderIndex) order.push(idx);
  }
  order.push(defenderIndex);
  for (const idx of order) {
    if (idx === -1) continue;
    const p = room.players[idx];
    while (p.hand.length < 6 && room.deck.length > 0) {
      p.hand.push(room.deck.pop());
    }
  }
}
function checkWinCondition(room) {
  const activePlayers = room.players.filter((p) => p.hand.length > 0 || room.deck.length > 0);
  if (activePlayers.length === 1) {
    room.status = "finished";
    room.winnerId = room.players.find((p) => p.id !== activePlayers[0].id)?.id || null;
  } else if (activePlayers.length === 0) {
    room.status = "finished";
    room.winnerId = "draw";
  }
}
function canDefend(attack, defense, trumpSuit) {
  if (defense.suit === attack.suit) return defense.value > attack.value;
  if (defense.suit === trumpSuit) return true;
  return false;
}
function canThrowIn(card, tableCards) {
  if (tableCards.length === 0) return true;
  return tableCards.some((t) => t.rank === card.rank);
}
function resetTurnTimer(roomId) {
  const room = getRoom(roomId);
  if (!room || room.status !== "playing") return;
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnStartTime = Date.now();
  const timerSeconds = room.settings.timer || 30;
  room.turnTimer = setTimeout(() => {
    const currentRoom = getRoom(roomId);
    if (!currentRoom || currentRoom.status !== "playing") return;
    if (currentRoom.turnPhase === "defend") {
      handleTake(roomId, currentRoom.defenderId);
    } else {
      handlePass(roomId, currentRoom.attackerId);
    }
  }, timerSeconds * 1e3);
}
function handleBotTurn(roomId) {
  const room = getRoom(roomId);
  if (!room || room.status !== "playing") return;
  const attacker = room.players.find((p) => p.id === room.attackerId);
  const defender = room.players.find((p) => p.id === room.defenderId);
  if (!attacker || !defender) return;
  if (attacker.isBot && (room.turnPhase === "attack" || room.turnPhase === "throw_in" || room.turnPhase === "take_throw_in")) {
    setTimeout(() => {
      const currentRoom = getRoom(roomId);
      if (!currentRoom || currentRoom.turnPhase !== room.turnPhase) return;
      const bot = currentRoom.players.find((p) => p.id === attacker.id);
      const cheatCard = currentRoom.table.find((t) => t.isCheat && !t.challenged);
      if (cheatCard && Math.random() < 0.8) {
        currentRoom.table.forEach((t) => {
          if (t === cheatCard) t.challenged = true;
        });
        broadcastRoomState(roomId);
        return;
      }
      const tableCards = currentRoom.table.flatMap((t) => t.defense ? [t.attack, t.defense] : [t.attack]);
      const sortedHand = [...bot.hand].sort((a, b) => {
        const aTrump = a.suit === currentRoom.trumpSuit;
        const bTrump = b.suit === currentRoom.trumpSuit;
        if (aTrump && !bTrump) return 1;
        if (!aTrump && bTrump) return -1;
        return a.value - b.value;
      });
      let played = false;
      if (currentRoom.turnPhase === "attack") {
        const card = sortedHand[0];
        bot.hand = bot.hand.filter((c) => c.id !== card.id);
        currentRoom.table.push({ attack: card, playedById: bot.id });
        currentRoom.turnPhase = "defend";
        played = true;
        resetTurnTimer(roomId);
      } else {
        const playable = sortedHand.find((c) => canThrowIn(c, tableCards));
        const defenderHandSize = currentRoom.players.find((p) => p.id === currentRoom.defenderId).hand.length;
        const undefended = currentRoom.table.filter((t) => !t.defense).length;
        if (playable && undefended < defenderHandSize) {
          if (playable.suit !== currentRoom.trumpSuit || bot.difficulty === "hard") {
            bot.hand = bot.hand.filter((c) => c.id !== playable.id);
            currentRoom.table.push({ attack: playable, playedById: bot.id });
            currentRoom.turnPhase = currentRoom.turnPhase === "take_throw_in" ? "take_throw_in" : "defend";
            played = true;
            resetTurnTimer(roomId);
          }
        }
      }
      if (!played && (currentRoom.turnPhase === "throw_in" || currentRoom.turnPhase === "take_throw_in")) {
        handlePass(roomId, bot.id);
      } else {
        broadcastRoomState(roomId);
        if (played) handleBotTurn(roomId);
      }
    }, 1e3);
  }
  if (defender.isBot && room.turnPhase === "defend") {
    setTimeout(() => {
      const currentRoom = getRoom(roomId);
      if (!currentRoom || currentRoom.turnPhase !== "defend") return;
      const bot = currentRoom.players.find((p) => p.id === defender.id);
      const undefendedIndex = currentRoom.table.findIndex((t) => !t.defense);
      if (undefendedIndex !== -1) {
        const attackCard = currentRoom.table[undefendedIndex].attack;
        const sortedHand = [...bot.hand].sort((a, b) => {
          const aTrump = a.suit === currentRoom.trumpSuit;
          const bTrump = b.suit === currentRoom.trumpSuit;
          if (aTrump && !bTrump) return 1;
          if (!aTrump && bTrump) return -1;
          return a.value - b.value;
        });
        const playable = sortedHand.find((c) => canDefend(attackCard, c, currentRoom.trumpSuit));
        if (playable) {
          bot.hand = bot.hand.filter((c) => c.id !== playable.id);
          currentRoom.table[undefendedIndex].defense = playable;
          const allDefended = currentRoom.table.every((t) => t.defense);
          currentRoom.turnPhase = allDefended ? "throw_in" : "defend";
          broadcastRoomState(roomId);
          handleBotTurn(roomId);
        } else {
          handleTake(roomId, bot.id);
        }
      }
    }, 1e3);
  }
}
function handlePass(roomId, playerId) {
  const room = getRoom(roomId);
  if (!room || room.status !== "playing") return;
  if (playerId === room.attackerId && (room.turnPhase === "throw_in" || room.turnPhase === "take_throw_in")) {
    if (room.turnPhase === "take_throw_in") {
      const defender = room.players.find((p) => p.id === room.defenderId);
      const tableCards = room.table.flatMap((t) => t.defense ? [t.attack, t.defense] : [t.attack]);
      defender.hand.push(...tableCards);
      replenishHands(room);
      room.table = [];
      const attackerIndex = room.players.findIndex((p) => p.id === room.attackerId);
      const nextDefenderIndex = getNextPlayer(room, getNextPlayer(room, attackerIndex));
      room.defenderId = room.players[nextDefenderIndex].id;
      room.turnPhase = "attack";
    } else {
      const tableCards = room.table.flatMap((t) => t.defense ? [t.attack, t.defense] : [t.attack]);
      room.discardPile.push(...tableCards);
      replenishHands(room);
      room.table = [];
      room.attackerId = room.defenderId;
      const attackerIndex = room.players.findIndex((p) => p.id === room.attackerId);
      room.defenderId = room.players[getNextPlayer(room, attackerIndex)].id;
      room.turnPhase = "attack";
    }
    checkWinCondition(room);
    broadcastRoomState(roomId);
    handleBotTurn(roomId);
  }
}
function handleTake(roomId, playerId) {
  const room = getRoom(roomId);
  if (!room || room.status !== "playing") return;
  if (playerId === room.defenderId && room.turnPhase === "defend") {
    room.turnPhase = "take_throw_in";
    broadcastRoomState(roomId);
    handleBotTurn(roomId);
  }
}
io.on("connection", (socket) => {
  let currentRoomId = null;
  let currentPlayerId = null;
  socket.on("ping", (callback) => {
    if (typeof callback === "function") {
      callback();
    }
  });
  socket.on("quick_play", (name, avatar) => {
    let foundRoomId = null;
    for (const [rId, room] of rooms.entries()) {
      if (room.status === "waiting" && room.players.length < room.settings.maxPlayers && !room.roomId.startsWith("PRIVATE_")) {
        foundRoomId = rId;
        break;
      }
    }
    if (!foundRoomId) {
      foundRoomId = "ROOM_" + Math.random().toString(36).substring(2, 8).toUpperCase();
    }
    socket.emit("quick_play_found", foundRoomId);
  });
  socket.on("join_room", (roomId, name, avatar) => {
    socket.join(roomId);
    currentRoomId = roomId;
    currentPlayerId = socket.id;
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        roomId,
        hostId: socket.id,
        players: [],
        status: "waiting",
        deck: [],
        deckSize: 0,
        discardPile: [],
        discardSize: 0,
        trumpCard: null,
        trumpSuit: null,
        table: [],
        attackerId: null,
        defenderId: null,
        turnPhase: "waiting",
        winnerId: null,
        messages: [],
        settings: { deckSize: 36, maxPlayers: 6, mode: "podkidnoy", cheatMode: false, timer: 30 }
      });
    }
    const room = rooms.get(roomId);
    const existingPlayer = room.players.find((p) => p.id === socket.id);
    if (!existingPlayer) {
      room.players.push({
        id: socket.id,
        name,
        avatar,
        isBot: false,
        hand: [],
        handSize: 0,
        connected: true,
        socketId: socket.id,
        cheatPenaltyTurns: 0
      });
    } else {
      existingPlayer.connected = true;
      existingPlayer.socketId = socket.id;
    }
    const activePlayers = room.players.filter((p) => !p.isBot && p.connected);
    if (!room.hostId || !activePlayers.find((p) => p.id === room.hostId)) {
      room.hostId = activePlayers.length > 0 ? activePlayers[0].id : null;
    }
    broadcastRoomState(roomId);
  });
  socket.on("update_settings", (settings) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.status === "playing" || room.hostId !== currentPlayerId) return;
    room.settings = settings;
    broadcastRoomState(currentRoomId);
  });
  socket.on("add_bot", (difficulty) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.status === "playing") return;
    const botNames = ["\u0410\u044E\u0431", "\u0418\u0441\u043B\u0430\u043C", "\u0414\u0430\u0443\u0434", "\u041C\u0430\u0433\u0430", "\u0410\u0434\u0430\u043C", "\u0410\u043C\u0438\u0440"];
    const name = botNames[room.players.filter((p) => p.isBot).length % botNames.length];
    room.players.push({
      id: `bot_${(0, import_uuid.v4)()}`,
      name: `${name} (\u0411\u043E\u0442)`,
      isBot: true,
      hand: [],
      handSize: 0,
      connected: true,
      difficulty,
      cheatPenaltyTurns: 0
    });
    broadcastRoomState(currentRoomId);
  });
  socket.on("back_to_lobby", () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== currentPlayerId) return;
    if (room.status !== "finished") return;
    room.status = "waiting";
    room.winnerId = null;
    room.table = [];
    room.discardPile = [];
    room.deck = [];
    room.players.forEach((p) => {
      p.hand = [];
    });
    broadcastRoomState(currentRoomId);
  });
  socket.on("start_game", (settings) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== currentPlayerId) return;
    if (room.status === "playing") return;
    room.players = room.players.filter((p) => p.connected || p.isBot);
    if (room.players.length < 2) return;
    room.settings = settings;
    room.deck = createDeck(settings.deckSize);
    room.trumpCard = room.deck[0];
    room.trumpSuit = room.trumpCard.suit;
    room.discardPile = [];
    room.table = [];
    room.status = "playing";
    room.winnerId = null;
    room.players.forEach((p) => {
      p.hand = room.deck.splice(-6, 6);
    });
    let lowestTrumpVal = 100;
    let firstAttackerIdx = 0;
    room.players.forEach((p, idx) => {
      const trumps = p.hand.filter((c) => c.suit === room.trumpSuit);
      if (trumps.length > 0) {
        const min = Math.min(...trumps.map((c) => c.value));
        if (min < lowestTrumpVal) {
          lowestTrumpVal = min;
          firstAttackerIdx = idx;
        }
      }
    });
    room.attackerId = room.players[firstAttackerIdx].id;
    room.defenderId = room.players[getNextPlayer(room, firstAttackerIdx)].id;
    room.turnPhase = "attack";
    resetTurnTimer(currentRoomId);
    broadcastRoomState(currentRoomId);
    handleBotTurn(currentRoomId);
  });
  socket.on("play_card", (cardId) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.status !== "playing") return;
    const player = room.players.find((p) => p.id === currentPlayerId);
    if (!player) return;
    if (player.cheatPenaltyTurns > 0) {
      player.cheatPenaltyTurns--;
      const isDefender2 = room.defenderId === currentPlayerId;
      if (!isDefender2) {
        socket.emit("error", "\u0412\u044B \u043F\u043E\u0434 \u0448\u0442\u0440\u0430\u0444\u043E\u043C, \u043C\u043E\u0436\u0435\u0442\u0435 \u0442\u043E\u043B\u044C\u043A\u043E \u043E\u0442\u0431\u0438\u0432\u0430\u0442\u044C\u0441\u044F!");
        return;
      }
    }
    const cardIndex = player.hand.findIndex((c) => c.id === cardId);
    if (cardIndex === -1) return;
    const card = player.hand[cardIndex];
    const isAttacker = room.attackerId === currentPlayerId;
    const isDefender = room.defenderId === currentPlayerId;
    if (isAttacker) {
      if (room.turnPhase === "attack" && room.table.length === 0) {
        player.hand.splice(cardIndex, 1);
        room.table.push({ attack: card, playedById: currentPlayerId, isCheat: !room.settings.cheatMode && !canThrowIn(card, []) });
        room.turnPhase = "defend";
        broadcastRoomState(currentRoomId);
        handleBotTurn(currentRoomId);
      } else if (room.turnPhase === "throw_in" || room.turnPhase === "take_throw_in") {
        const tableCards = room.table.flatMap((t) => t.defense ? [t.attack, t.defense] : [t.attack]);
        const isValid = room.settings.cheatMode || canThrowIn(card, tableCards);
        if (isValid) {
          const defenderHandSize = room.players.find((p) => p.id === room.defenderId).hand.length;
          const undefended = room.table.filter((t) => !t.defense).length;
          if (undefended < defenderHandSize) {
            player.hand.splice(cardIndex, 1);
            room.table.push({ attack: card, playedById: currentPlayerId, isCheat: !isValid });
            room.turnPhase = room.turnPhase === "take_throw_in" ? "take_throw_in" : "defend";
            broadcastRoomState(currentRoomId);
            handleBotTurn(currentRoomId);
          }
        }
      }
    } else if (isDefender && room.turnPhase === "defend") {
      const allUndefended = room.table.every((t) => !t.defense);
      const isTransferable = room.settings.mode === "perevodnoy" && allUndefended && room.table.length > 0 && (room.settings.cheatMode || card.rank === room.table[0].attack.rank);
      if (isTransferable) {
        const defenderIndex = room.players.findIndex((p) => p.id === room.defenderId);
        const nextDefenderIndex = getNextPlayer(room, defenderIndex);
        const nextDefender = room.players[nextDefenderIndex];
        if (nextDefender.hand.length >= room.table.length + 1) {
          player.hand.splice(cardIndex, 1);
          room.table.push({ attack: card, playedById: currentPlayerId });
          room.attackerId = room.defenderId;
          room.defenderId = nextDefender.id;
          broadcastRoomState(currentRoomId);
          handleBotTurn(currentRoomId);
          return;
        }
      }
      const undefendedIndex = room.table.findIndex((t) => !t.defense);
      if (undefendedIndex !== -1) {
        const attackCard = room.table[undefendedIndex].attack;
        if (room.settings.cheatMode || canDefend(attackCard, card, room.trumpSuit)) {
          player.hand.splice(cardIndex, 1);
          room.table[undefendedIndex].defense = card;
          const allDefended = room.table.every((t) => t.defense);
          room.turnPhase = allDefended ? "throw_in" : "defend";
          broadcastRoomState(currentRoomId);
          handleBotTurn(currentRoomId);
        }
      }
    }
  });
  socket.on("pass", () => {
    if (currentRoomId && currentPlayerId) handlePass(currentRoomId, currentPlayerId);
  });
  socket.on("take", () => {
    if (currentRoomId && currentPlayerId) handleTake(currentRoomId, currentPlayerId);
  });
  socket.on("challenge_card", (attackCardId) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.status !== "playing") return;
    const tableCard = room.table.find((t) => t.attack.id === attackCardId);
    if (!tableCard || tableCard.challenged) return;
    if (tableCard.playedById === currentPlayerId) return;
    tableCard.challenged = true;
    const cheater = room.players.find((p) => p.id === tableCard.playedById);
    if (cheater) {
      cheater.cheatPenaltyTurns = 3;
    }
    broadcastRoomState(currentRoomId);
  });
  socket.on("send_message", (text) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const player = room.players.find((p) => p.id === currentPlayerId);
    if (!player) return;
    const msg = {
      id: (0, import_uuid.v4)(),
      senderId: player.id,
      senderName: player.name,
      text,
      timestamp: Date.now()
    };
    room.messages.push(msg);
    io.to(currentRoomId).emit("chat_message", msg);
  });
  socket.on("disconnect", () => {
    if (currentRoomId && currentPlayerId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        const player = room.players.find((p) => p.id === currentPlayerId);
        if (player) {
          player.connected = false;
          if (room.status === "playing") {
            player.isBot = true;
            player.name = `${player.name} (\u0411\u043E\u0442)`;
            player.difficulty = "medium";
            handleBotTurn(currentRoomId);
          } else {
            room.players = room.players.filter((p) => p.id !== currentPlayerId);
          }
          const activePlayers = room.players.filter((p) => !p.isBot && p.connected);
          if (!room.hostId || !activePlayers.find((p) => p.id === room.hostId)) {
            room.hostId = activePlayers.length > 0 ? activePlayers[0].id : null;
          }
          broadcastRoomState(currentRoomId);
        }
      }
    }
  });
});
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
startServer();
