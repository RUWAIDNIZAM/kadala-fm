const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder,
    ActivityType 
} = require('discord.js');

const { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    getVoiceConnection,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    StreamType 
} = require('@discordjs/voice');

const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const express = require('express');

// ==========================================
// 🌐 KEEP-ALIVE WEB SERVER (For Render/Free Hosts)
// ==========================================
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('📻 Kadala FM is alive and streaming!');
});

app.listen(port, () => {
    console.log(`[Web Server] Listening on port ${port} to keep the bot awake.`);
});

// ==========================================
// 📻 THE TAMIL FM DICTIONARY
// ==========================================
const TAMIL_FMS = {
    suryan: { 
        name: "Suryan FM", 
        urls: [ 
            "http://104.238.193.114:7077/;stream.mp3",
            "https://playerservices.streamtheworld.com/api/livestream-redirect/SURYAN_FM.mp3"
        ] 
    },
    hellofm: {
        name: "Hello FM 106.4",
        urls: [ "http://163.172.158.94:8048/;stream.mp3" ]
    },
    mirchi: { 
        name: "Radio Mirchi 98.3", 
        urls: [ 
            "http://51.222.87.239:7200/1", 
            "http://163.172.158.94:8052/;stream.mp3" 
        ] 
    },
    bigfm: {
        name: "Big FM 92.7",
        urls: [ 
            "http://51.222.87.239:7200/3",
            "http://163.172.158.94:8062/;stream.mp3" 
        ]
    },
    radiocity: {
        name: "Radio City 91.1",
        urls: [
            "http://51.222.87.239:7200/2",
            "http://163.172.158.94:8064/;stream.mp3"
        ]
    },
    rainbow: {
        name: "Chennai FM Rainbow",
        urls: [ "http://163.172.158.94:8066/;stream.mp3" ]
    },
    lankasri: { 
        name: "Lankasri FM", 
        urls: [ 
            "http://media2.lankasri.fm/;stream.mp3",
            "https://cdn.lankasri.com/lankasri.m3u8"
        ] 
    }
};

// ==========================================
// 🤖 BOT SETUP & INTENTS
// ==========================================
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildVoiceStates 
    ] 
});

const guildPlayers = new Map();
const activeStreams = new Map(); 

// --- The High-Compression Audio Engine ---
function playRadioStream(guildId) {
    const player = guildPlayers.get(guildId);
    const streamData = activeStreams.get(guildId);
    
    if (!player || !streamData) return;

    const urlToPlay = streamData.station.urls[streamData.urlIndex];
    console.log(`[Radio] Streaming ${streamData.station.name} -> Using format fallback index: ${streamData.urlIndex}`);
    
    try {
        const ffmpegArgs = [
            '-i', urlToPlay,
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-vn', 
            '-c:a', 'libopus', 
            '-b:a', '32k', // Aggressive compression to prevent stuttering
            '-vbr', 'on', 
            '-compression_level', '10', 
            '-ac', '2', 
            '-ar', '48000', 
            '-f', 'ogg', 
            'pipe:1' 
        ];

        const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

        ffmpegProcess.stderr.on('data', () => {}); // Handle logs silently

        const resource = createAudioResource(ffmpegProcess.stdout, {
            inputType: StreamType.OggOpus,
        });

        player.play(resource);

    } catch (error) {
        console.error("[Audio Resource Error]", error.message);
    }
}

client.once('ready', () => {
    console.log(`Kadala FM is online with High-Compression Audio enabled.`);
    client.user.setActivity('Kadala FM 24/7', { type: ActivityType.Listening });
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    const content = message.content.toLowerCase();

    // ==========================================
    // COMMAND: KADALA FM (JOIN & PLAY 24/7)
    // ==========================================
    if (content === 'kadala fm') {
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) {
            return message.reply("Bro, jump into a voice channel first!");
        }

        const replyMsg = await message.reply("📻 Tuning the antennas...");
        const guildId = message.guild.id;

        let connection = getVoiceConnection(guildId);
        if (connection) {
            connection.destroy();
            connection = null;
        }

        try {
            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: true 
            });

            await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
        } catch (error) {
            if (connection) connection.destroy();
            return replyMsg.edit("⚠️ Connection timed out. Make sure your server isn't blocking Discord Voice UDP ports.");
        }

        if (!guildPlayers.has(guildId)) {
            const player = createAudioPlayer();
            guildPlayers.set(guildId, player);
            
            // Set default station to Suryan FM
            activeStreams.set(guildId, { station: TAMIL_FMS.suryan, urlIndex: 0 });

            player.on('error', error => {
                console.error(`[Audio Drop] ${error.message}`);
                const streamData = activeStreams.get(guildId);
                if (streamData) {
                    streamData.urlIndex++;
                    if (streamData.urlIndex >= streamData.station.urls.length) {
                        streamData.urlIndex = 0;
                    }
                    console.log(`Switching to fallback format ${streamData.urlIndex}...`);
                }
            });

            player.on(AudioPlayerStatus.Idle, () => {
                playRadioStream(guildId);
            });
        }

        const player = guildPlayers.get(guildId);
        connection.subscribe(player);
        playRadioStream(guildId);

        const currentStream = activeStreams.get(guildId);
        client.user.setActivity(currentStream.station.name, { type: ActivityType.Listening });

        try {
            await voiceChannel.setName(`📻・${currentStream.station.name}`);
        } catch (error) {} 

        await replyMsg.edit(`📻 Locked onto **${currentStream.station.name}**! Vibe mode engaged.`);
    }

    // ==========================================
    // COMMAND: KADALA LIST (SWITCH STATIONS)
    // ==========================================
    if (content === 'kadala list') {
        const options = Object.keys(TAMIL_FMS).map(key => ({
            label: TAMIL_FMS[key].name,
            value: key,
            emoji: '📻'
        }));

        options.push({
            label: 'Stop & Disconnect',
            value: 'stop',
            emoji: '🛑'
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('fm_select')
            .setPlaceholder('Switch the station...')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const embed = new EmbedBuilder()
            .setTitle('📻 Kadala FM Menu')
            .setDescription('Select a new live station below.')
            .setColor('#FF4500');

        await message.reply({ embeds: [embed], components: [row] });
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu() || interaction.customId !== 'fm_select') return;

    const guildId = interaction.guild.id;
    const selectedValue = interaction.values[0];
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
        return interaction.reply({ content: 'Run `kadala fm` from a voice channel first!', ephemeral: true });
    }

    if (selectedValue === 'stop') {
        const connection = getVoiceConnection(guildId);
        if (connection) {
            connection.destroy();
            guildPlayers.delete(guildId);
            activeStreams.delete(guildId);
            client.user.setActivity('Kadala FM 24/7', { type: ActivityType.Listening });
            return interaction.reply({ content: '🛑 Kadala FM disconnected. Catch you later!' });
        }
        return interaction.reply({ content: 'I am not playing anything right now.', ephemeral: true });
    }

    const stationObj = TAMIL_FMS[selectedValue];
    const player = guildPlayers.get(guildId);

    if (!player) {
        return interaction.reply({ content: 'Start the bot first using `kadala fm`!', ephemeral: true });
    }

    activeStreams.set(guildId, { station: stationObj, urlIndex: 0 });
    playRadioStream(guildId);
    client.user.setActivity(stationObj.name, { type: ActivityType.Listening });

    try {
        await voiceChannel.setName(`📻・${stationObj.name}`);
    } catch (error) {}

    await interaction.reply({ content: `🎶 Now playing: **${stationObj.name}**` });
});

client.login(process.env.DISCORD_TOKEN);
