// ════════════════════════════════════════════════════════════════════════════
//  🤖 BOT DISCORD TIẾNG VIỆT v2.3
//  ✅ Backup tạo MÃ 6 ký tự unique (chỉ Admin thấy, DM bí mật)
//  ✅ /restore mã:<MÃ> — nhập đúng mã mới khôi phục được
//  ✅ YouTube + Spotify, skip fix, listener fix, connection fix
//  ✅ VTV · Nối từ · Bầu cua · Trinh chiếu · Mod · Anti · Monitor
// ════════════════════════════════════════════════════════════════════════════
require("dotenv").config();

const {
  Client, GatewayIntentBits, EmbedBuilder,
  REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require("discord.js");
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  getVoiceConnection,
} = require("@discordjs/voice");
const ytdl = require("@distube/ytdl-core");
const fs   = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("\n❌ THIẾU BIẾN MÔI TRƯỜNG!");
  console.error("   Tạo file .env:\n   DISCORD_TOKEN=token\n   CLIENT_ID=client_id\n");
  process.exit(1);
}

// ─── 6 MẶT BẦU CUA ────────────────────────────────────────────────────────────
const FACES = {
  1:{name:"Nai",emoji:"🦌"},
  2:{name:"Bầu",emoji:"🎰"},
  3:{name:"Gà",emoji:"🐓"},
  4:{name:"Cá",emoji:"🐟"},
  5:{name:"Cua",emoji:"🦀"},
  6:{name:"Tôm",emoji:"🦐"},
};

// ─── LOAD DICTIONARY ──────────────────────────────────────────────────────────
let DICT = [];
try {
  DICT = JSON.parse(fs.readFileSync(path.join(__dirname,"dictionary.json"),"utf-8"));
  console.log("📖 Đã nạp từ điển: "+DICT.length+" từ");
} catch {
  console.warn("⚠️  Không tìm thấy dictionary.json — dùng mẫu");
  DICT = ["học sinh","sinh viên","viên chức","chức vụ","vụ án","án oan","oan khuất","khuất phục","phục vụ","mùa xuân","xuân hè"];
}
const VI_INDEX = Object.create(null);
for (const w of DICT) {
  const key = w.trim().split(/\s+/)[0].toLowerCase();
  if (!Array.isArray(VI_INDEX[key])) VI_INDEX[key] = [];
  VI_INDEX[key].push(w);
}

// ─── STATE ────────────────────────────────────────────────────────────────────
const S = {
  vtvCh:{}, noiViCh:{}, noiEnCh:{}, noiViSt:{}, noiEnSt:{},
  logCh:{}, anti:{}, warns:{}, spam:{},
  // Backup: key = mã 6 ký tự → snapshot
  // Cũng lưu backupCode[guildId] = mã mới nhất của guild đó
  backupStore: {}, // mã → snapshot
  backupCode:  {}, // guildId → mã
  joinLog:{}, leaveLog:{}, msgLog:{}, chMsgLog:{},
  musicQueue:{}, musicPlaying:{},
};

// File lưu backup store (tất cả backup theo mã)
const BACKUP_STORE_FILE = path.join(__dirname, "backup_store.json");

// Load backup store từ file khi khởi động
function loadBackupStore() {
  try {
    if (fs.existsSync(BACKUP_STORE_FILE)) {
      const data = JSON.parse(fs.readFileSync(BACKUP_STORE_FILE,"utf-8"));
      S.backupStore = data.store || {};
      S.backupCode  = data.codes || {};
      const count = Object.keys(S.backupStore).length;
      if (count > 0) console.log("📦 Đã load "+count+" backup(s) từ file");
    }
  } catch(e) { console.error("Load backup store error:", e.message); }
}
function saveBackupStore() {
  try {
    fs.writeFileSync(BACKUP_STORE_FILE, JSON.stringify({store:S.backupStore, codes:S.backupCode}, null, 2), "utf-8");
  } catch(e) { console.error("Save backup store error:", e.message); }
}

// Tạo mã backup 6 ký tự unique (A-Z0-9, không trùng với mã đã có)
function generateBackupCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // bỏ I,O,0,1 dễ nhầm
  let code;
  do {
    code = Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
  } while (S.backupStore[code]); // đảm bảo không trùng
  return code;
}

loadBackupStore();

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const normalize  = s => s.replace(/[\s\/]/g,"").split("").sort().join("").toLowerCase();
const lastSyl    = w => w.trim().split(/\s+/).pop().toLowerCase();
const firstSyl   = w => w.trim().split(/\s+/)[0].toLowerCase();
const isAdmin    = mb => mb?.permissions?.has(PermissionFlagsBits.Administrator);
const isMod      = mb => mb?.permissions?.has(PermissionFlagsBits.ManageMessages)||isAdmin(mb);
const today      = () => new Date().toISOString().slice(0,10);
const EP         = {flags:64};

function solveAnagram(letters) {
  const t = normalize(letters);
  return DICT.find(w => normalize(w)===t) || null;
}
function findWordVI(syl,used) {
  const c = (VI_INDEX[syl]||[]).filter(w=>!used.has(w.toLowerCase()));
  return c.length ? c[Math.floor(Math.random()*c.length)] : null;
}
function hintVI(syl,used,n=5) { return (VI_INDEX[syl]||[]).filter(w=>!used.has(w.toLowerCase())).slice(0,n); }
function findWordEN(letter,used) {
  const c = DICT.filter(w=>/^[a-z\s'-]+$/i.test(w)&&w[0].toLowerCase()===letter&&!used.has(w.toLowerCase()));
  return c.length ? c[Math.floor(Math.random()*c.length)] : null;
}
function hintEN(letter,used,n=5) { return DICT.filter(w=>/^[a-z\s'-]+$/i.test(w)&&w[0].toLowerCase()===letter&&!used.has(w.toLowerCase())).slice(0,n); }
function parseDuration(str) {
  const m = str?.match(/^(\d+)(s|m|h|d)$/i); if (!m) return null;
  const n = +m[1];
  return {s:n*1000,m:n*60000,h:n*3600000,d:n*86400000}[m[2].toLowerCase()];
}
function trackMsg(gid,chId) {
  const d = today();
  if (!S.msgLog[gid]) S.msgLog[gid]={};
  S.msgLog[gid][d] = (S.msgLog[gid][d]||0)+1;
  if (!S.chMsgLog[gid]) S.chMsgLog[gid]={};
  if (!S.chMsgLog[gid][chId]) S.chMsgLog[gid][chId]={lastMsg:0,count:0};
  S.chMsgLog[gid][chId].lastMsg=Date.now();
  S.chMsgLog[gid][chId].count++;
}
async function sendLog(guild,embed) {
  const id=S.logCh[guild.id]; if (!id) return;
  try { guild.channels.cache.get(id)?.send({embeds:[embed]}); } catch {}
}

// ─── SPOTIFY ──────────────────────────────────────────────────────────────────
function fetchSpotifyInfo(url) {
  return new Promise(resolve => {
    const ourl = "https://open.spotify.com/oembed?url="+encodeURIComponent(url);
    const req = https.get(ourl,{timeout:6000},res=>{
      let data="";
      res.on("data",c=>data+=c);
      res.on("end",()=>{
        try { const j=JSON.parse(data); resolve({title:j.title||null,thumbnail:j.thumbnail_url||null}); }
        catch { resolve(null); }
      });
    });
    req.on("error",()=>resolve(null));
    req.on("timeout",()=>{ req.destroy(); resolve(null); });
  });
}
function searchYouTube(query) {
  return new Promise(resolve => {
    const q = encodeURIComponent(query+" official audio");
    const req = https.get("https://www.youtube.com/results?search_query="+q,{
      headers:{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
      timeout:8000
    },res=>{
      let data="";
      res.on("data",c=>data+=c);
      res.on("end",()=>{
        const m = data.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
        resolve(m ? "https://www.youtube.com/watch?v="+m[1] : null);
      });
    });
    req.on("error",()=>resolve(null));
    req.on("timeout",()=>{ req.destroy(); resolve(null); });
  });
}
function detectLink(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/spotify\.com\/track/i.test(url))    return "spotify_track";
  if (/spotify\.com\/playlist/i.test(url)) return "spotify_playlist";
  if (/spotify\.com\/album/i.test(url))    return "spotify_album";
  return null;
}

// ─── MUSIC ────────────────────────────────────────────────────────────────────
async function getYTTitle(url) {
  try { return (await ytdl.getBasicInfo(url)).videoDetails.title; } catch { return url; }
}

async function playNext(gid, channel) {
  const queue = S.musicQueue[gid];
  const playing = S.musicPlaying[gid];
  if (!playing?.player) return;

  if (!queue || queue.length===0) {
    setTimeout(()=>{
      if (!(S.musicQueue[gid]?.length)) {
        getVoiceConnection(gid)?.destroy();
        delete S.musicPlaying[gid];
        channel?.send("✅ Hết hàng chờ — Bot đã rời voice!").catch(()=>{});
      }
    },30000);
    return;
  }

  const item = queue[0];
  // Xoá hết listeners cũ, tránh leak
  playing.player.removeAllListeners(AudioPlayerStatus.Idle);
  playing.player.removeAllListeners("error");

  try {
    if (!ytdl.validateURL(item.url)) {
      channel?.send("❌ Link không hợp lệ, bỏ qua: **"+item.title+"**").catch(()=>{});
      queue.shift(); return playNext(gid,channel);
    }

    const stream = ytdl(item.url,{filter:"audioonly",quality:"highestaudio",highWaterMark:1<<25,liveBuffer:4000});
    stream.on("error",err=>{
      const msg = err.message.includes("Sign in")?"Video giới hạn tuổi/riêng tư":err.message;
      channel?.send("❌ Stream lỗi **"+item.title+"**: "+msg).catch(()=>{});
      queue.shift(); playNext(gid,channel);
    });

    const resource = createAudioResource(stream,{inlineVolume:true});
    resource.volume?.setVolume(1.0);
    playing.player.play(resource);
    playing.current = item;

    // Khi bài xong: nếu không đang skip → shift queue rồi play next
    playing.player.once(AudioPlayerStatus.Idle,()=>{
      if (!playing.skipping) S.musicQueue[gid]?.shift();
      playing.skipping = false;
      playNext(gid,channel);
    });
    playing.player.once("error",err=>{
      channel?.send("❌ Player lỗi **"+item.title+"**").catch(()=>{});
      if (!playing.skipping) S.musicQueue[gid]?.shift();
      playing.skipping = false;
      playNext(gid,channel);
    });

    channel?.send({embeds:[new EmbedBuilder().setColor(0xff0000)
      .setTitle("🎵 Đang phát"+(item.source==="spotify"?" 🟢":""  ))
      .setDescription("**"+item.title+"**\n"+item.url)
      .addFields(
        {name:"Yêu cầu",value:item.requestedBy,inline:true},
        {name:"Còn lại",value:Math.max(0,queue.length-1)+" bài",inline:true},
        {name:"Nguồn",value:item.source==="spotify"?"🟢 Spotify":"🔴 YouTube",inline:true},
      ).setTimestamp()
    ]}).catch(()=>{});

  } catch(err) {
    const msg = err.message.includes("Private")?"Video riêng tư":err.message.includes("removed")?"Video bị xoá":err.message;
    channel?.send("❌ Không thể phát **"+item.title+"**: "+msg).catch(()=>{});
    queue.shift(); playNext(gid,channel);
  }
}

function ensureConnection(voiceCh,guild) {
  const existing = getVoiceConnection(guild.id);
  if (existing) {
    if (existing.joinConfig?.channelId===voiceCh.id) return existing;
    existing.destroy();
  }
  const conn = joinVoiceChannel({channelId:voiceCh.id,guildId:guild.id,adapterCreator:guild.voiceAdapterCreator,selfDeaf:false});
  conn.on(VoiceConnectionStatus.Disconnected,async()=>{
    try { await Promise.race([entersState(conn,VoiceConnectionStatus.Signalling,5000),entersState(conn,VoiceConnectionStatus.Connecting,5000)]); }
    catch { conn.destroy(); delete S.musicPlaying[guild.id]; delete S.musicQueue[guild.id]; }
  });
  return conn;
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────
const client = new Client({
  intents:[
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// ─── SLASH COMMANDS ───────────────────────────────────────────────────────────
const SLASH_CMDS = [
  // GAME
  new SlashCommandBuilder().setName("vtv").setDescription("🎮 Giải chữ đảo VTV (chỉ mình thấy)")
    .addStringOption(o=>o.setName("chu").setDescription("Bộ chữ VD: t/n/í/ự/t/h").setRequired(true)),
  new SlashCommandBuilder().setName("baucua").setDescription("🎲 Tính xác suất Bầu Cua (chỉ mình thấy)")
    .addIntegerOption(o=>o.setName("mat").setDescription("1=🦌 2=🎰 3=🐓 4=🐟 5=🦀 6=🦐").setMinValue(1).setMaxValue(6).setRequired(true)),
  new SlashCommandBuilder().setName("mset").setDescription("⚙️ Đặt kênh cho tính năng")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption(o=>o.setName("tinh_nang").setDescription("Tính năng").setRequired(true)
      .addChoices({name:"🎮 VTV",value:"vtv"},{name:"🔗 Nối từ VI",value:"noitu_vi"},{name:"🔗 Nối từ EN",value:"noitu_en"})),
  new SlashCommandBuilder().setName("goiytunoi").setDescription("💡 Gợi ý từ nối (chỉ mình thấy)")
    .addStringOption(o=>o.setName("am_tiet").setDescription("Âm tiết hoặc chữ cái").setRequired(true))
    .addStringOption(o=>o.setName("ngon_ngu")
      .addChoices({name:"🇻🇳 Tiếng Việt",value:"vi"},{name:"🇬🇧 Tiếng Anh",value:"en"})),

  // VIDEO
  new SlashCommandBuilder().setName("trinhchieuvideo").setDescription("📺 Chia sẻ video cho cả nhóm")
    .addStringOption(o=>o.setName("link").setDescription("Link YouTube").setRequired(true))
    .addStringOption(o=>o.setName("mo_ta").setDescription("Mô tả")),

  // NHẠC
  new SlashCommandBuilder().setName("play").setDescription("🎵 Phát nhạc YouTube hoặc Spotify")
    .addStringOption(o=>o.setName("link").setDescription("Link YouTube hoặc Spotify track/playlist/album").setRequired(true)),
  new SlashCommandBuilder().setName("stop").setDescription("⏹️ Dừng nhạc và rời voice"),
  new SlashCommandBuilder().setName("skip").setDescription("⏭️ Bỏ qua bài hiện tại"),
  new SlashCommandBuilder().setName("pause").setDescription("⏸️ Tạm dừng nhạc"),
  new SlashCommandBuilder().setName("resume").setDescription("▶️ Tiếp tục nhạc"),
  new SlashCommandBuilder().setName("queue").setDescription("📋 Xem hàng chờ nhạc"),
  new SlashCommandBuilder().setName("nowplaying").setDescription("🎵 Xem bài đang phát"),
  new SlashCommandBuilder().setName("clearqueue").setDescription("🗑️ Xoá toàn bộ hàng chờ (giữ bài đang phát)"),

  // MOD
  new SlashCommandBuilder().setName("kick").setDescription("👢 Kick thành viên")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o=>o.setName("user").setRequired(true))
    .addStringOption(o=>o.setName("ly_do")),
  new SlashCommandBuilder().setName("ban").setDescription("🔨 Ban thành viên")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o=>o.setName("user").setRequired(true))
    .addStringOption(o=>o.setName("ly_do")),
  new SlashCommandBuilder().setName("mute").setDescription("🔇 Mute có thời hạn")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o=>o.setName("user").setRequired(true))
    .addStringOption(o=>o.setName("thoi_gian").setDescription("VD: 10m 1h 2d").setRequired(true))
    .addStringOption(o=>o.setName("ly_do")),
  new SlashCommandBuilder().setName("unmute").setDescription("🔊 Bỏ mute")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o=>o.setName("user").setRequired(true)),
  new SlashCommandBuilder().setName("clear").setDescription("🗑️ Xoá tin nhắn (1-100)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o=>o.setName("so_luong").setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName("warn").setDescription("⚠️ Cảnh cáo (3 lần → mute 30p)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o=>o.setName("user").setRequired(true))
    .addStringOption(o=>o.setName("ly_do").setRequired(true)),
  new SlashCommandBuilder().setName("warnlist").setDescription("📋 Xem số cảnh cáo")
    .addUserOption(o=>o.setName("user").setRequired(true)),
  new SlashCommandBuilder().setName("warnreset").setDescription("🔄 Xoá cảnh cáo")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o=>o.setName("user").setRequired(true)),

  // ANTI & LOG
  new SlashCommandBuilder().setName("anti").setDescription("🛡️ Bật/tắt bảo vệ tự động")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o=>o.setName("tinh_nang").setRequired(true)
      .addChoices({name:"🔗 Anti Link",value:"link"},{name:"📨 Anti Invite",value:"invite"},{name:"💬 Anti Spam",value:"spam"},{name:"📊 Xem trạng thái",value:"status"}))
    .addStringOption(o=>o.setName("trang_thai").addChoices({name:"✅ Bật",value:"on"},{name:"❌ Tắt",value:"off"}))
    .addStringOption(o=>o.setName("hen_gio_bat").setDescription("Hẹn giờ bật VD: 30m"))
    .addStringOption(o=>o.setName("hen_gio_tat").setDescription("Hẹn giờ tắt VD: 2h")),
  new SlashCommandBuilder().setName("setlog").setDescription("📝 Đặt kênh log")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o=>o.setName("kenh").setRequired(true)),

  // MONITOR
  new SlashCommandBuilder().setName("serverhealth").setDescription("📊 Sức khoẻ server")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("rolescan").setDescription("👥 Phân tích role")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder().setName("permscan").setDescription("🔐 Quét quyền bất thường")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // BACKUP + RESTORE với MÃ
  new SlashCommandBuilder().setName("backup").setDescription("💾 Sao lưu cấu trúc server — nhận MÃ bí mật để khôi phục")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o=>o.setName("hanh_dong").setRequired(true)
      .addChoices({name:"💾 Lưu backup (tạo mã mới)",value:"save"},{name:"📋 Xem thông tin backup",value:"view"})),

  new SlashCommandBuilder().setName("restore").setDescription("♻️ Khôi phục server từ backup bằng MÃ 6 ký tự")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o=>o.setName("ma").setDescription("Mã backup 6 ký tự (VD: AB3X7K)").setRequired(true)),

  new SlashCommandBuilder().setName("exporttemplate").setDescription("📤 Xuất cấu trúc server ra file .txt")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // HELP
  new SlashCommandBuilder().setName("help").setDescription("📖 Hướng dẫn toàn bộ tính năng")
    .addStringOption(o=>o.setName("muc")
      .addChoices(
        {name:"🎮 Game",value:"game"},
        {name:"🎵 Nhạc & Video",value:"music"},
        {name:"🛡️ Moderation",value:"mod"},
        {name:"📊 Monitor",value:"monitor"},
        {name:"📦 Backup & Restore",value:"backup"},
      )),
].map(c=>c.toJSON());

// ─── READY ────────────────────────────────────────────────────────────────────
client.once("clientReady",async()=>{
  console.log("✅ Bot online: "+client.user.tag);
  client.user.setActivity("📖 /help | 🎵 YT+Spotify | 💾 /backup",{type:3});
  try {
    const rest = new REST({version:"10"}).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID),{body:SLASH_CMDS});
    console.log("✅ Đăng ký Slash Commands thành công!");
  } catch(e) { console.error("❌ Lỗi đăng ký:",e.message); }
});

// ─── MEMBER TRACKING ──────────────────────────────────────────────────────────
client.on("guildMemberAdd",m=>{
  if (!S.joinLog[m.guild.id]) S.joinLog[m.guild.id]=[];
  S.joinLog[m.guild.id].push(Date.now());
});
client.on("guildMemberRemove",m=>{
  if (!S.leaveLog[m.guild.id]) S.leaveLog[m.guild.id]=[];
  S.leaveLog[m.guild.id].push(Date.now());
});

// ─── MESSAGE CREATE ───────────────────────────────────────────────────────────
client.on("messageCreate",async msg=>{
  if (msg.author.bot||!msg.guild) return;
  const gid=msg.guild.id, content=msg.content.trim();
  const anti=S.anti[gid]||{};
  trackMsg(gid,msg.channel.id);

  // Anti Invite
  if (anti.invite&&!isMod(msg.member)&&/discord\.gg\/\S+/i.test(content)) {
    await msg.delete().catch(()=>{});
    msg.channel.send("🚫 <@"+msg.author.id+"> không được đăng link mời server khác!")
      .then(m=>setTimeout(()=>m.delete().catch(()=>{}),5000));
    sendLog(msg.guild,new EmbedBuilder().setColor(0xed4245).setTitle("🛡️ Anti Invite")
      .addFields({name:"User",value:msg.author.tag,inline:true},{name:"Kênh",value:"<#"+msg.channel.id+">",inline:true}).setTimestamp());
    return;
  }
  // Anti Link
  if (anti.link&&!isMod(msg.member)&&/https?:\/\/\S+/i.test(content)&&!/discord\.gg/i.test(content)) {
    await msg.delete().catch(()=>{});
    msg.channel.send("🔗 <@"+msg.author.id+"> không được đăng link tại đây!")
      .then(m=>setTimeout(()=>m.delete().catch(()=>{}),5000));
    return;
  }
  // Anti Spam
  if (anti.spam&&!isMod(msg.member)) {
    if (!S.spam[gid]) S.spam[gid]={};
    if (!S.spam[gid][msg.author.id]) S.spam[gid][msg.author.id]=[];
    const now=Date.now();
    S.spam[gid][msg.author.id]=[...S.spam[gid][msg.author.id].filter(t=>now-t<5000),now];
    if (S.spam[gid][msg.author.id].length>=5) {
      await msg.member.timeout(10*60*1000,"Auto-mute spam").catch(()=>{});
      msg.channel.send("🔇 <@"+msg.author.id+"> đã bị **tự động mute 10 phút** do spam!");
      sendLog(msg.guild,new EmbedBuilder().setColor(0xed4245).setTitle("🤖 Auto-Mute Spam")
        .addFields({name:"User",value:msg.author.tag}).setTimestamp());
      S.spam[gid][msg.author.id]=[];
      return;
    }
  }
  // Auto VTV
  if (S.vtvCh[gid]===msg.channel.id&&content.includes("Từ cần đoán:")) {
    const m=content.match(/Từ cần đoán:\s*([^\n]+)/i);
    if (m) {
      const ans=solveAnagram(m[1].trim());
      msg.channel.send(ans
        ?{embeds:[new EmbedBuilder().setColor(0x57f287).setTitle("🎮 VTV — Đáp án!")
            .addFields({name:"Bộ chữ",value:"`"+m[1].trim()+"`",inline:true},{name:"✅ Đáp án",value:"**"+ans+"**",inline:true})]}
        :"❓ Không tìm thấy đáp án cho: `"+m[1].trim()+"`"
      );
    }
    return;
  }
  // Nối từ VI
  if (S.noiViCh[gid]===msg.channel.id&&!content.startsWith("/")) {
    const st=S.noiViSt[gid]||{lastWord:null,usedWords:new Set()};
    const word=content.toLowerCase().trim();
    if (!DICT.some(w=>w.toLowerCase()===word)){msg.react("❌");return;}
    if (st.usedWords.has(word)) return msg.reply("⚠️ Từ **"+word+"** đã dùng rồi!");
    if (st.lastWord&&firstSyl(word)!==lastSyl(st.lastWord))
      return msg.reply("❌ Phải bắt đầu bằng **\""+lastSyl(st.lastWord)+"\"**! Từ cuối: **"+st.lastWord+"**");
    st.usedWords.add(word); st.lastWord=word; msg.react("✅");
    const bw=findWordVI(lastSyl(word),st.usedWords);
    const hints=hintVI(lastSyl(word),bw?new Set([...st.usedWords,bw.toLowerCase()]):st.usedWords,4);
    if (!bw){S.noiViSt[gid]=st;return msg.channel.send("😵 **Bot thua!** Không có từ bắt đầu **\""+lastSyl(word)+"\"**");}
    st.usedWords.add(bw.toLowerCase()); st.lastWord=bw; S.noiViSt[gid]=st;
    msg.channel.send("🤖 **"+bw+"**\n➡️ Bắt đầu: **\""+lastSyl(bw)+"\"**"+(hints.length?"\n💡 Gợi ý: "+hints.map(h=>"`"+h+"`").join(", "):""));
    return;
  }
  // Nối từ EN
  if (S.noiEnCh[gid]===msg.channel.id&&!content.startsWith("/")) {
    const st=S.noiEnSt[gid]||{lastWord:null,usedWords:new Set()};
    const word=content.toLowerCase().trim();
    if (!/^[a-z\s'-]+$/.test(word)||!DICT.some(w=>/^[a-z\s'-]+$/i.test(w)&&w.toLowerCase()===word)){msg.react("❌");return;}
    if (st.usedWords.has(word)) return msg.reply("⚠️ Word **"+word+"** already used!");
    if (st.lastWord&&word[0]!==st.lastWord[st.lastWord.length-1])
      return msg.reply("❌ Must start with **\""+st.lastWord[st.lastWord.length-1].toUpperCase()+"\"**!");
    st.usedWords.add(word); st.lastWord=word; msg.react("✅");
    const bw=findWordEN(word[word.length-1],st.usedWords);
    const hints=hintEN(word[word.length-1],bw?new Set([...st.usedWords,bw.toLowerCase()]):st.usedWords,4);
    if (!bw){S.noiEnSt[gid]=st;return msg.channel.send("😵 **Bot loses!** No word starting **\""+word[word.length-1].toUpperCase()+"\"**");}
    st.usedWords.add(bw.toLowerCase()); st.lastWord=bw; S.noiEnSt[gid]=st;
    msg.channel.send("🤖 **"+bw+"**\n➡️ Start with: **\""+bw[bw.length-1].toUpperCase()+"\"**"+(hints.length?"\n💡 Hints: "+hints.map(h=>"`"+h+"`").join(", "):""));
    return;
  }
});

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────
client.on("interactionCreate",async interaction=>{
  try {
    // Button
    if (interaction.isButton()) {
      if (interaction.customId.startsWith("join_watch_")) {
        const by=interaction.customId.replace("join_watch_","");
        return interaction.reply({content:"🍿 <@"+interaction.user.id+"> đã tham gia xem cùng <@"+by+">! 🎬"});
      }
      return;
    }
    if (!interaction.isChatInputCommand()||!interaction.guild) return;
    const {commandName:cmd,guild,member}=interaction;
    const gid=guild.id;

    // ══════════════════════════════════════════════════════════════════════
    //  /help
    // ══════════════════════════════════════════════════════════════════════
    if (cmd==="help") {
      const muc=interaction.options.getString("muc");
      let embed;
      if (!muc) {
        embed=new EmbedBuilder().setColor(0x5865f2).setTitle("📖 BOT DISCORD TIẾNG VIỆT v2.3")
          .setDescription("Dùng `/help muc:<mục>` để xem chi tiết.")
          .addFields(
            {name:"🎮 GAME",value:"`/vtv` `/baucua` `/mset` `/goiytunoi`"},
            {name:"🎵 NHẠC & VIDEO",value:"`/play` (YouTube+Spotify🟢) `/stop` `/skip` `/pause` `/resume` `/queue` `/nowplaying` `/clearqueue` `/trinhchieuvideo`"},
            {name:"🛡️ MOD",value:"`/kick` `/ban` `/mute` `/unmute` `/clear` `/warn` `/warnlist` `/warnreset` `/anti` `/setlog`"},
            {name:"📊 MONITOR",value:"`/serverhealth` `/rolescan` `/permscan`"},
            {name:"📦 BACKUP MỨC 3",value:"`/backup save` → nhận **MÃ 6 ký tự** bí mật\n`/restore ma:<MÃ>` → nhập mã để khôi phục bất kỳ server nào\n`/backup view` `/exporttemplate`"},
          );
      } else if (muc==="backup") {
        embed=new EmbedBuilder().setColor(0x5865f2).setTitle("📦 BACKUP MỨC 3 — Hệ thống Mã Bí Mật")
          .addFields(
            {name:"💾 /backup save",value:"Sao lưu server → bot **DM riêng** cho bạn một **Mã 6 ký tự** (VD: `AB3X7K`)\n• Mã này **chỉ mình bạn biết** — không ai khác xem được\n• Mã **không trùng** với bất kỳ backup nào khác\n• Lưu vào file `backup_store.json` — **không mất khi restart**"},
            {name:"📋 /backup view",value:"Xem thông tin backup gần nhất của server hiện tại (không hiện mã)"},
            {name:"♻️ /restore ma:<MÃ>",value:"Nhập đúng mã 6 ký tự → bot tạo lại toàn bộ:\n① **Role** (tên, màu, quyền, hoist)\n② **Category** (thứ tự)\n③ **Kênh text/voice** (topic, bitrate, slowmode...)\n\n💡 **Dùng xuyên server:** Lấy mã từ server A → dùng /restore trong server B → server B có cấu trúc y hệt A!\n⚠️ Bot cần quyền **Administrator** trong server đích"},
            {name:"📤 /exporttemplate",value:"Xuất cấu trúc ra file .txt đính kèm"},
          );
      } else if (muc==="music") {
        embed=new EmbedBuilder().setColor(0xff0000).setTitle("🎵 NHẠC & VIDEO")
          .addFields(
            {name:"/play link:URL",value:"🔴 **YouTube**: `https://youtu.be/xxx` hoặc `https://youtube.com/watch?v=xxx`\n🟢 **Spotify**: `https://open.spotify.com/track/xxx`\n    Bot tự tìm trên YouTube → phát (không cần API key!)\n🟢 **Spotify Playlist/Album**: phát track đại diện"},
            {name:"/stop",value:"Dừng phát + xoá hàng chờ + rời voice"},
            {name:"/skip",value:"Bỏ qua bài hiện tại (đã fix bug skip 2 bài)"},
            {name:"/pause & /resume",value:"Tạm dừng / tiếp tục"},
            {name:"/queue",value:"Xem danh sách hàng chờ"},
            {name:"/nowplaying",value:"Bài đang phát + nguồn + người yêu cầu"},
            {name:"/clearqueue",value:"Xoá hàng chờ, giữ bài đang phát"},
          );
      } else if (muc==="game") {
        embed=new EmbedBuilder().setColor(0x57f287).setTitle("🎮 GAME")
          .addFields(
            {name:"🎮 VTV",value:"`/vtv chu:t/n/í/ự/t/h` — Chỉ mình thấy\nAuto: `/mset vtv` → bot đọc tin có `Từ cần đoán:`"},
            {name:"🔗 Nối từ",value:"`/mset noitu_vi` hoặc `noitu_en` → gõ từ → bot nối tiếp\n`/goiytunoi am_tiet:sinh` — gợi ý từ"},
            {name:"🎲 Bầu Cua",value:"`/baucua mat:5` (5=Cua) · 6 mặt: 🦌🎰🐓🐟🦀🦐"},
          );
      } else if (muc==="mod") {
        embed=new EmbedBuilder().setColor(0xed4245).setTitle("🛡️ MODERATION")
          .addFields(
            {name:"Lệnh",value:"`/kick /ban /mute /unmute /clear /warn /warnlist /warnreset`\nMute: `s` `m` `h` `d` (VD: `10m`, `1h`, `2d`) — tối đa 28 ngày"},
            {name:"🛡️ Anti",value:"`/anti link/invite/spam on/off` · Hẹn giờ: `hen_gio_bat:30m`\n3 warn → tự mute 30 phút"},
            {name:"📝 Log",value:"`/setlog #kênh` — ghi log tất cả hành động mod"},
          );
      } else if (muc==="monitor") {
        embed=new EmbedBuilder().setColor(0xfee75c).setTitle("📊 SERVER MONITOR")
          .addFields(
            {name:"/serverhealth",value:"Tăng trưởng 7 ngày · tin nhắn · top kênh · kênh chết"},
            {name:"/rolescan",value:"Role không dùng · role nguy hiểm · quyền thừa"},
            {name:"/permscan",value:"Quyền Administrator · Manage Server · @everyone"},
          );
      }
      return interaction.reply({embeds:[embed],...EP});
    }

    // /mset
    if (cmd==="mset") {
      const tf=interaction.options.getString("tinh_nang"),chId=interaction.channel.id,chName=interaction.channel.name;
      if (tf==="vtv"){S.vtvCh[gid]=chId;return interaction.reply({content:"✅ **#"+chName+"** → VTV",...EP});}
      if (tf==="noitu_vi"){S.noiViCh[gid]=chId;S.noiViSt[gid]={lastWord:null,usedWords:new Set()};return interaction.reply({content:"✅ **#"+chName+"** → Nối từ VI",...EP});}
      if (tf==="noitu_en"){S.noiEnCh[gid]=chId;S.noiEnSt[gid]={lastWord:null,usedWords:new Set()};return interaction.reply({content:"✅ **#"+chName+"** → Nối từ EN",...EP});}
    }

    // /vtv
    if (cmd==="vtv") {
      const letters=interaction.options.getString("chu"),ans=solveAnagram(letters);
      const e=new EmbedBuilder().setColor(ans?0x57f287:0xed4245).setTitle("🎮 VTV — Đáp án (chỉ mình thấy)");
      ans?e.addFields({name:"Bộ chữ",value:"`"+letters+"`",inline:true},{name:"✅ Đáp án",value:"**"+ans+"**",inline:true}):e.setDescription("❌ Không tìm thấy từ: `"+letters+"`");
      return interaction.reply({embeds:[e],...EP});
    }

    // /goiytunoi
    if (cmd==="goiytunoi") {
      const at=interaction.options.getString("am_tiet").toLowerCase().trim();
      const lang=interaction.options.getString("ngon_ngu")||"vi";
      const words=lang==="vi"?hintVI(at,new Set(),10):hintEN(at,new Set(),10);
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x5865f2)
        .setTitle("💡 Gợi ý từ — "+(lang==="vi"?"🇻🇳 VI":"🇬🇧 EN")+" (chỉ mình thấy)")
        .setDescription(words.length?"Bắt đầu bằng **\""+at+"\"**:\n\n"+words.map((w,i)=>(i+1)+". `"+w+"`").join("\n"):"❌ Không có từ nào bắt đầu bằng **\""+at+"\"**")
      ],...EP});
    }

    // /baucua
    if (cmd==="baucua") {
      const mat=interaction.options.getInteger("mat"),face=FACES[mat];
      const rolls=[1,2,3].map(()=>Math.ceil(Math.random()*6));
      const hits=rolls.filter(r=>r===mat).length;
      const pNone=Math.pow(5/6,3),pAt1=(1-pNone)*100;
      const pEx1=3*(1/6)*Math.pow(5/6,2)*100,pEx2=3*Math.pow(1/6,2)*(5/6)*100,pEx3=Math.pow(1/6,3)*100;
      const ev=(pEx1/100)*1+(pEx2/100)*2+(pEx3/100)*3;
      const kq=hits===0?"😢 Không ra. **Thua!**":hits===1?"🎉 Ra **1 lần**! Thắng **x1**!":hits===2?"🎉🎉 Ra **2 lần**! Thắng **x2**!":"🎉🎉🎉 Ra **3 lần**! **Jackpot x3**!";
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0xfee75c)
        .setTitle("🎲 BẦU CUA — Bạn chọn: "+face.emoji+" "+face.name)
        .addFields(
          {name:"🎯 Kết quả",value:rolls.map(r=>FACES[r].emoji+" "+FACES[r].name).join("  |  ")+"\n\n"+kq},
          {name:"📊 Xác suất",value:"≥1 lần: **"+pAt1.toFixed(2)+"%**\n1 lần: **"+pEx1.toFixed(2)+"%**\n2 lần: **"+pEx2.toFixed(2)+"%**\n3 lần: **"+pEx3.toFixed(2)+"%**",inline:true},
          {name:"💰 EV",value:"**"+ev.toFixed(4)+"** "+(ev>=1?"✅":"❌ bất lợi"),inline:true},
        ).setFooter({text:"Chỉ mình thấy | Chơi có trách nhiệm!"})
      ],...EP});
    }

    // /trinhchieuvideo
    if (cmd==="trinhchieuvideo") {
      const link=interaction.options.getString("link"),moTa=interaction.options.getString("mo_ta")||"Cùng xem nào! 🍿";
      let vid=null;
      const m1=link.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/),m2=link.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (m1) vid=m1[1]; else if (m2) vid=m2[1];
      const e=new EmbedBuilder().setColor(0xff0000).setTitle("📺 TRINH CHIẾU VIDEO — Cả nhóm cùng xem!")
        .setDescription("<@"+interaction.user.id+"> muốn cả nhóm xem cùng!\n\n📝 **"+moTa+"**\n\n🔗 **Link:** "+link+"\n\n👇 Nhấn nút bên dưới!")
        .setTimestamp().setFooter({text:"Chia sẻ bởi "+interaction.user.tag});
      if (vid) e.setImage("https://img.youtube.com/vi/"+vid+"/hqdefault.jpg");
      const row=new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("▶️ Xem Video").setStyle(ButtonStyle.Link).setURL(link),
        new ButtonBuilder().setCustomId("join_watch_"+interaction.user.id).setLabel("✅ Tham gia xem").setStyle(ButtonStyle.Success),
      );
      return interaction.reply({embeds:[e],components:[row]});
    }

    // ══════════════════════════════════════════════════════════════════════
    //  /play — YouTube + Spotify
    // ══════════════════════════════════════════════════════════════════════
    if (cmd==="play") {
      const link=interaction.options.getString("link").trim();
      const lt=detectLink(link);
      if (!lt) return interaction.reply({content:"❌ Chỉ hỗ trợ link **YouTube** hoặc **Spotify**!\n• `https://youtu.be/xxx`\n• `https://open.spotify.com/track/xxx`",...EP});

      const voiceCh=interaction.member?.voice?.channel;
      if (!voiceCh) return interaction.reply({content:"❌ Bạn phải vào **Voice Channel** trước!",...EP});
      const perms=voiceCh.permissionsFor(guild.members.me);
      if (!perms.has(PermissionFlagsBits.Connect)||!perms.has(PermissionFlagsBits.Speak))
        return interaction.reply({content:"❌ Bot không có quyền vào/nói trong voice đó!",...EP});

      await interaction.deferReply();

      try {
        let item=null;

        if (lt==="youtube") {
          const title=await getYTTitle(link);
          item={url:link,title,requestedBy:interaction.user.tag,source:"youtube"};

        } else if (lt==="spotify_track") {
          await interaction.editReply({content:"🟢 Đang tìm trên Spotify..."});
          const info=await fetchSpotifyInfo(link);
          if (!info?.title) return interaction.editReply({content:"❌ Không lấy được thông tin từ Spotify!"});
          const ytUrl=await searchYouTube(info.title);
          if (!ytUrl) return interaction.editReply({content:"❌ Không tìm thấy **"+info.title+"** trên YouTube!"});
          item={url:ytUrl,title:info.title,requestedBy:interaction.user.tag,source:"spotify"};

        } else {
          // Playlist / Album
          await interaction.editReply({content:"🟢 Đang đọc Spotify playlist/album..."});
          const info=await fetchSpotifyInfo(link);
          const searchName=info?.title||"Spotify playlist";
          const ytUrl=await searchYouTube(searchName);
          if (!ytUrl) return interaction.editReply({content:"❌ Không tìm được bài từ playlist/album này!\n💡 Dùng link track cụ thể từ Spotify."});
          item={url:ytUrl,title:(info?.title||"Spotify track"),requestedBy:interaction.user.tag,source:"spotify"};
        }

        if (!S.musicQueue[gid]) S.musicQueue[gid]=[];
        S.musicQueue[gid].push(item);

        const isPlaying=S.musicPlaying[gid]?.player&&
          [AudioPlayerStatus.Playing,AudioPlayerStatus.Buffering].includes(S.musicPlaying[gid]?.player?.state?.status);

        if (isPlaying) {
          return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x57f287)
            .setTitle("✅ Đã thêm vào hàng chờ"+(item.source==="spotify"?" 🟢":""))
            .setDescription("**"+item.title+"**")
            .addFields(
              {name:"Vị trí",value:"#"+S.musicQueue[gid].length,inline:true},
              {name:"Nguồn",value:item.source==="spotify"?"🟢 Spotify":"🔴 YouTube",inline:true},
            )
          ]});
        }

        const conn=ensureConnection(voiceCh,guild);
        const player=createAudioPlayer();
        conn.subscribe(player);
        S.musicPlaying[gid]={connection:conn,player,current:null,skipping:false};

        await interaction.editReply({embeds:[new EmbedBuilder().setColor(0xff0000)
          .setTitle("🎵 Đã vào voice — Bắt đầu phát!"+(item.source==="spotify"?" 🟢":""))
          .setDescription("**"+item.title+"**")
          .addFields(
            {name:"Voice",value:voiceCh.name,inline:true},
            {name:"Nguồn",value:item.source==="spotify"?"🟢 Spotify":"🔴 YouTube",inline:true},
          ).setTimestamp()
        ]});

        playNext(gid,interaction.channel);

      } catch(err) {
        console.error("/play error:",err);
        return interaction.editReply({content:"❌ Lỗi: "+err.message});
      }
      return;
    }

    // /stop
    if (cmd==="stop") {
      const conn=getVoiceConnection(gid);
      if (!conn) return interaction.reply({content:"❌ Bot không ở trong voice nào!",...EP});
      S.musicQueue[gid]=[];
      S.musicPlaying[gid]?.player?.stop();
      conn.destroy();
      delete S.musicPlaying[gid];
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0xed4245).setTitle("⏹️ Đã dừng nhạc").setDescription("Bot rời voice và xoá hàng chờ.")]});
    }

    // /skip — FIX: dùng skipping flag tránh double-shift
    if (cmd==="skip") {
      const playing=S.musicPlaying[gid];
      if (!playing?.player) return interaction.reply({content:"❌ Không có bài nào đang phát!",...EP});
      const current=playing.current;
      S.musicQueue[gid]?.shift(); // shift trước
      playing.skipping=true;       // đánh dấu để playNext không shift lại
      playing.player.stop();        // trigger Idle → playNext
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0xfee75c)
        .setTitle("⏭️ Đã bỏ qua: "+(current?.title||"Bài không xác định"))
        .setFooter({text:"Còn "+(S.musicQueue[gid]?.length||0)+" bài trong queue"})
      ]});
    }

    // /pause
    if (cmd==="pause") {
      const player=S.musicPlaying[gid]?.player;
      if (!player||player.state.status!==AudioPlayerStatus.Playing)
        return interaction.reply({content:"❌ Không có bài nào đang phát!",...EP});
      player.pause();
      return interaction.reply({content:"⏸️ Đã **tạm dừng** nhạc."});
    }

    // /resume
    if (cmd==="resume") {
      const player=S.musicPlaying[gid]?.player;
      if (!player||player.state.status!==AudioPlayerStatus.Paused)
        return interaction.reply({content:"❌ Nhạc không đang tạm dừng!",...EP});
      player.unpause();
      return interaction.reply({content:"▶️ Đã **tiếp tục** nhạc."});
    }

    // /queue
    if (cmd==="queue") {
      const queue=S.musicQueue[gid]||[],current=S.musicPlaying[gid]?.current;
      if (!current&&!queue.length) return interaction.reply({content:"📋 Hàng chờ đang trống!",...EP});
      const list=queue.slice(0,10).map((it,i)=>(i+1)+". **"+it.title+"**"+(it.source==="spotify"?" 🟢":""  )+" — "+it.requestedBy).join("\n");
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle("📋 Hàng chờ nhạc")
        .addFields(
          {name:"🎵 Đang phát",value:current?(current.title+(current.source==="spotify"?" 🟢":"")):"Không có"},
          {name:"⏳ Tiếp theo ("+queue.length+" bài)",value:list||"Trống"},
        ).setFooter({text:queue.length>10?"...và "+(queue.length-10)+" bài nữa":""})
      ],...EP});
    }

    // /nowplaying
    if (cmd==="nowplaying") {
      const c=S.musicPlaying[gid]?.current;
      if (!c) return interaction.reply({content:"❌ Không có bài nào đang phát!",...EP});
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0xff0000)
        .setTitle("🎵 Đang phát"+(c.source==="spotify"?" 🟢 Spotify":""))
        .setDescription("**"+c.title+"**\n"+c.url)
        .addFields(
          {name:"Yêu cầu",value:c.requestedBy,inline:true},
          {name:"Còn lại",value:Math.max(0,(S.musicQueue[gid]?.length||1)-1)+" bài",inline:true},
          {name:"Nguồn",value:c.source==="spotify"?"🟢 Spotify":"🔴 YouTube",inline:true},
        ).setTimestamp()
      ],...EP});
    }

    // /clearqueue
    if (cmd==="clearqueue") {
      if (!S.musicQueue[gid]?.length) return interaction.reply({content:"📋 Hàng chờ đã trống!",...EP});
      const removed=(S.musicQueue[gid]?.length||1)-1;
      S.musicQueue[gid]?.splice(1); // giữ index 0 (đang phát)
      return interaction.reply({content:"🗑️ Đã xoá **"+removed+"** bài. Bài đang phát vẫn tiếp tục."});
    }

    // /kick
    if (cmd==="kick") {
      const target=interaction.options.getMember("user"),reason=interaction.options.getString("ly_do")||"Không có lý do";
      if (!target?.kickable) return interaction.reply({content:"❌ Không thể kick người này!",...EP});
      await target.kick(reason);
      sendLog(guild,new EmbedBuilder().setColor(0xff6600).setTitle("👢 KICK").addFields({name:"User",value:target.user.tag,inline:true},{name:"Mod",value:interaction.user.tag,inline:true},{name:"Lý do",value:reason}).setTimestamp());
      return interaction.reply({content:"✅ Đã kick **"+target.user.tag+"** — "+reason,...EP});
    }

    // /ban
    if (cmd==="ban") {
      const target=interaction.options.getMember("user"),reason=interaction.options.getString("ly_do")||"Không có lý do";
      if (!target?.bannable) return interaction.reply({content:"❌ Không thể ban người này!",...EP});
      await target.ban({reason});
      sendLog(guild,new EmbedBuilder().setColor(0xed4245).setTitle("🔨 BAN").addFields({name:"User",value:target.user.tag,inline:true},{name:"Mod",value:interaction.user.tag,inline:true},{name:"Lý do",value:reason}).setTimestamp());
      return interaction.reply({content:"✅ Đã ban **"+target.user.tag+"** — "+reason,...EP});
    }

    // /mute
    if (cmd==="mute") {
      const target=interaction.options.getMember("user"),timeStr=interaction.options.getString("thoi_gian");
      const reason=interaction.options.getString("ly_do")||"Không có lý do";
      const dur=parseDuration(timeStr);
      if (!dur) return interaction.reply({content:"❌ Thời gian không hợp lệ! VD: `10m` `1h` `2d`",...EP});
      if (dur>28*86400000) return interaction.reply({content:"❌ Tối đa 28 ngày!",...EP});
      await target.timeout(dur,reason);
      sendLog(guild,new EmbedBuilder().setColor(0xffa500).setTitle("🔇 MUTE").addFields({name:"User",value:target.user.tag,inline:true},{name:"Thời gian",value:timeStr,inline:true},{name:"Lý do",value:reason}).setTimestamp());
      return interaction.reply({content:"✅ Đã mute **"+target.user.tag+"** trong **"+timeStr+"**",...EP});
    }

    // /unmute
    if (cmd==="unmute") {
      const target=interaction.options.getMember("user");
      await target.timeout(null);
      sendLog(guild,new EmbedBuilder().setColor(0x57f287).setTitle("🔊 UNMUTE").addFields({name:"User",value:target.user.tag}).setTimestamp());
      return interaction.reply({content:"✅ Đã bỏ mute **"+target.user.tag+"**",...EP});
    }

    // /clear
    if (cmd==="clear") {
      const amount=interaction.options.getInteger("so_luong");
      const deleted=await interaction.channel.bulkDelete(amount,true);
      sendLog(guild,new EmbedBuilder().setColor(0x99aab5).setTitle("🗑️ CLEAR").addFields({name:"Số tin",value:""+deleted.size,inline:true},{name:"Kênh",value:"<#"+interaction.channel.id+">",inline:true},{name:"Mod",value:interaction.user.tag,inline:true}).setTimestamp());
      return interaction.reply({content:"✅ Đã xoá **"+deleted.size+"** tin nhắn",...EP});
    }

    // /warn
    if (cmd==="warn") {
      const target=interaction.options.getMember("user"),reason=interaction.options.getString("ly_do");
      if (!S.warns[gid]) S.warns[gid]={};
      if (!S.warns[gid][target.id]) S.warns[gid][target.id]=0;
      S.warns[gid][target.id]++;
      const count=S.warns[gid][target.id];
      if (count>=3) {
        await target.timeout(30*60*1000,"3 cảnh cáo").catch(()=>{});
        interaction.channel.send("⚠️ <@"+target.id+"> nhận **3 cảnh cáo** → **Mute 30 phút!**");
      }
      sendLog(guild,new EmbedBuilder().setColor(0xffa500).setTitle("⚠️ WARN").addFields({name:"User",value:target.user.tag,inline:true},{name:"Số lần",value:count+"/3",inline:true},{name:"Lý do",value:reason}).setTimestamp());
      return interaction.reply({content:"⚠️ Đã cảnh cáo **"+target.user.tag+"** ("+count+"/3) — "+reason+(count>=3?"\n🔇 Đã mute 30 phút!":""),...EP});
    }

    // /warnlist
    if (cmd==="warnlist") {
      const target=interaction.options.getMember("user"),count=S.warns[gid]?.[target.id]||0;
      return interaction.reply({embeds:[new EmbedBuilder().setColor(count>=3?0xed4245:0xffa500)
        .setTitle("⚠️ Cảnh cáo: "+target.user.tag)
        .addFields({name:"Số lần",value:"**"+count+"/3**",inline:true},{name:"Trạng thái",value:count===0?"✅ Chưa có":count>=3?"🔴 Đã mute":"🟡 "+count+"/3",inline:true})
      ],...EP});
    }

    // /warnreset
    if (cmd==="warnreset") {
      const target=interaction.options.getMember("user");
      if (S.warns[gid]) S.warns[gid][target.id]=0;
      return interaction.reply({content:"✅ Đã xoá cảnh cáo của **"+target.user.tag+"**",...EP});
    }

    // /anti
    if (cmd==="anti") {
      const tf=interaction.options.getString("tinh_nang"),st=interaction.options.getString("trang_thai");
      const hb=interaction.options.getString("hen_gio_bat"),ht=interaction.options.getString("hen_gio_tat");
      if (!S.anti[gid]) S.anti[gid]={link:false,invite:false,spam:false};
      if (tf==="status") {
        const a=S.anti[gid];
        return interaction.reply({embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle("🛡️ Trạng thái Anti")
          .addFields({name:"🔗 Anti Link",value:a.link?"✅ Bật":"❌ Tắt",inline:true},{name:"📨 Anti Invite",value:a.invite?"✅ Bật":"❌ Tắt",inline:true},{name:"💬 Anti Spam",value:a.spam?"✅ Bật":"❌ Tắt",inline:true})
        ],...EP});
      }
      const key={link:"link",invite:"invite",spam:"spam"}[tf]; if (!key) return;
      let msg="";
      if (hb){const d=parseDuration(hb);if(d){setTimeout(()=>{if(!S.anti[gid])S.anti[gid]={};S.anti[gid][key]=true;},d);msg+="⏰ Sẽ **bật** sau **"+hb+"**\n";}}
      if (ht){const d=parseDuration(ht);if(d){setTimeout(()=>{if(!S.anti[gid])S.anti[gid]={};S.anti[gid][key]=false;},d);msg+="⏰ Sẽ **tắt** sau **"+ht+"**\n";}}
      if (st){S.anti[gid][key]=st==="on";msg+=(st==="on"?"✅ Đã **bật**":"❌ Đã **tắt**")+" **Anti "+tf+"**";}
      return interaction.reply({content:msg||"ℹ️ Không có thay đổi.",...EP});
    }

    // /setlog
    if (cmd==="setlog") {
      const ch=interaction.options.getChannel("kenh"); S.logCh[gid]=ch.id;
      return interaction.reply({content:"✅ Kênh log: <#"+ch.id+">",...EP});
    }

    // /serverhealth
    if (cmd==="serverhealth") {
      await interaction.deferReply({...EP});
      try{await guild.members.fetch();}catch{}
      const members=guild.memberCount,bots=guild.members.cache.filter(m=>m.user.bot).size;
      const w7=Date.now()-7*86400000;
      const joins7=(S.joinLog[gid]||[]).filter(t=>t>w7).length,leaves7=(S.leaveLog[gid]||[]).filter(t=>t>w7).length;
      const t=today(),y=new Date(Date.now()-86400000).toISOString().slice(0,10);
      const mT=S.msgLog[gid]?.[t]||0,mY=S.msgLog[gid]?.[y]||0;
      const cl=S.chMsgLog[gid]||{};
      const top=Object.entries(cl).sort((a,b)=>b[1].count-a[1].count).slice(0,3).map(([id,v])=>"<#"+id+">: **"+v.count+"** tin");
      const dead=guild.channels.cache.filter(c=>c.type===ChannelType.GuildText&&(!cl[c.id]||cl[c.id].lastMsg<w7)).map(c=>"<#"+c.id+">").slice(0,5);
      const net=joins7-leaves7;
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(net>=0?0x57f287:0xed4245)
        .setTitle("📊 Sức khoẻ: "+guild.name)
        .addFields(
          {name:(net>0?"📈":"📉")+" Tình trạng",value:net>0?"Đang tăng trưởng":net<0?"Đang giảm":"Ổn định"},
          {name:"👥 Thành viên",value:(members-bots)+" người + "+bots+" bot = **"+members+"** tổng"},
          {name:"📈 7 ngày",value:"+"+joins7+" join · -"+leaves7+" rời · Net: "+(net>=0?"+":"")+net},
          {name:"💬 Tin nhắn hôm nay",value:"**"+mT+"** (hôm qua: "+mY+")"},
          {name:"🔥 Top kênh",value:top.join("\n")||"Chưa có dữ liệu"},
          {name:"💀 Kênh chết 7 ngày",value:dead.join(", ")||"✅ Tất cả hoạt động"},
        ).setTimestamp()
      ]});
    }

    // /rolescan
    if (cmd==="rolescan") {
      await interaction.deferReply({...EP});
      try{await guild.members.fetch();}catch{}
      const roles=guild.roles.cache.filter(r=>r.id!==guild.id);
      const empty=[],danger=[],warn=[];
      for (const [,r] of roles) {
        const cnt=guild.members.cache.filter(m=>m.roles.cache.has(r.id)).size;
        if (cnt===0) empty.push(r.name);
        if (r.permissions.has(PermissionFlagsBits.Administrator)) danger.push("🔴 **"+r.name+"** — Admin ("+cnt+" người)");
        else if (r.permissions.has(PermissionFlagsBits.BanMembers)&&cnt===0) warn.push("🟡 **"+r.name+"** — Ban nhưng không ai dùng");
      }
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(0xffa500).setTitle("👥 ROLE SCAN")
        .addFields(
          {name:"🚮 Role không ai dùng ("+empty.length+")",value:empty.slice(0,15).join(", ")||"✅ Không có"},
          {name:"⚠️ Role nguy hiểm ("+danger.length+")",value:danger.slice(0,8).join("\n")||"✅ Không có"},
          {name:"🔍 Cảnh báo ("+warn.length+")",value:warn.slice(0,8).join("\n")||"✅ Không có"},
        ).setTimestamp()
      ]});
    }

    // /permscan
    if (cmd==="permscan") {
      await interaction.deferReply({...EP});
      const ws=[];
      guild.roles.cache.forEach(r=>{
        if (r.id===guild.id) return;
        if (r.permissions.has(PermissionFlagsBits.Administrator)) ws.push("🔴 **"+r.name+"** — Administrator");
        if (r.permissions.has(PermissionFlagsBits.ManageGuild)) ws.push("🟠 **"+r.name+"** — Manage Server");
        if (r.permissions.has(PermissionFlagsBits.BanMembers)) ws.push("🟡 **"+r.name+"** — Ban Members");
      });
      guild.channels.cache.filter(c=>c.type===ChannelType.GuildText).forEach(ch=>{
        const ep=ch.permissionOverwrites.cache.get(guild.id);
        if (ep?.allow.has(PermissionFlagsBits.SendMessages)) ws.push("🟡 **#"+ch.name+"** cho @everyone gửi tin");
        if (ep?.allow.has(PermissionFlagsBits.ManageMessages)) ws.push("🔴 **#"+ch.name+"** cho @everyone xoá tin — NGUY HIỂM!");
      });
      return interaction.editReply({embeds:[new EmbedBuilder()
        .setColor(ws.length===0?0x57f287:ws.some(w=>w.startsWith("🔴"))?0xed4245:0xffa500)
        .setTitle("🔐 PERMISSION SCAN")
        .setDescription(ws.length?ws.slice(0,15).join("\n"):"✅ Không phát hiện vấn đề bảo mật!")
        .addFields({name:"Tổng cảnh báo",value:""+ws.length,inline:true},{name:"🔴 Nghiêm trọng",value:""+ws.filter(w=>w.startsWith("🔴")).length,inline:true})
        .setTimestamp()
      ]});
    }

    // ══════════════════════════════════════════════════════════════════════
    //  /backup — tạo MÃ BÍ MẬT, DM cho Admin
    // ══════════════════════════════════════════════════════════════════════
    if (cmd==="backup") {
      const action=interaction.options.getString("hanh_dong");

      if (action==="save") {
        await interaction.deferReply({...EP});

        // Thu thập dữ liệu
        const cats=guild.channels.cache.filter(c=>c.type===ChannelType.GuildCategory)
          .sort((a,b)=>a.position-b.position)
          .map(c=>({id:c.id,name:c.name,position:c.position}));
        const channels=guild.channels.cache.filter(c=>c.type!==ChannelType.GuildCategory)
          .sort((a,b)=>a.position-b.position)
          .map(c=>({id:c.id,name:c.name,type:c.type,parentId:c.parentId||null,position:c.position,topic:c.topic||null,nsfw:c.nsfw||false,bitrate:c.bitrate||null,userLimit:c.userLimit||null,rateLimitPerUser:c.rateLimitPerUser||0}));
        const roles=guild.roles.cache.filter(r=>r.id!==guild.id&&!r.managed)
          .sort((a,b)=>a.position-b.position)
          .map(r=>({id:r.id,name:r.name,color:r.color,hexColor:r.hexColor,permissions:r.permissions.bitfield.toString(),position:r.position,hoist:r.hoist,mentionable:r.mentionable}));

        // Tạo mã unique
        const code=generateBackupCode();
        const snapshot={
          code, guildName:guild.name, guildId:gid,
          savedAt:new Date().toISOString(),
          savedBy:interaction.user.tag,
          cats, channels, roles
        };

        // Lưu vào store
        S.backupStore[code]=snapshot;
        S.backupCode[gid]=code; // mã mới nhất của guild này
        saveBackupStore(); // lưu xuống file

        // DM mã bí mật cho Admin (chỉ mình Admin biết)
        let dmSuccess=false;
        try {
          const dmEmbed=new EmbedBuilder().setColor(0x57f287)
            .setTitle("🔐 MÃ BACKUP BÍ MẬT CỦA BẠN")
            .setDescription(
              "# `"+code+"`\n\n"+
              "⚠️ **BẢO MẬT MÃ NÀY!** Ai có mã này đều có thể khôi phục cấu trúc server của bạn!\n\n"+
              "📋 **Cách dùng:**\n"+
              "Trong server cần khôi phục → gõ:\n"+
              "```/restore ma:"+code+"```\n"+
              "💡 Bot sẽ tạo lại toàn bộ role + category + kênh theo đúng cấu trúc server **"+guild.name+"**"
            )
            .addFields(
              {name:"🏠 Server",value:guild.name,inline:true},
              {name:"📂 Category",value:""+cats.length,inline:true},
              {name:"📁 Kênh",value:""+channels.length,inline:true},
              {name:"👥 Role",value:""+roles.length,inline:true},
              {name:"🕐 Lưu lúc",value:new Date().toLocaleString("vi-VN"),inline:false},
            )
            .setFooter({text:"Mã backup bí mật — Chỉ mình bạn thấy tin nhắn này"})
            .setTimestamp();

          await interaction.user.send({embeds:[dmEmbed]});
          dmSuccess=true;
        } catch {
          dmSuccess=false; // User tắt DM
        }

        // Reply trong kênh (không tiết lộ mã)
        const replyEmbed=new EmbedBuilder().setColor(0x57f287).setTitle("💾 BACKUP THÀNH CÔNG!")
          .addFields(
            {name:"🏠 Server",value:guild.name,inline:true},
            {name:"📂 Category",value:""+cats.length,inline:true},
            {name:"📁 Kênh",value:""+channels.length,inline:true},
            {name:"👥 Role",value:""+roles.length,inline:true},
            {name:"🕐 Lưu lúc",value:new Date().toLocaleString("vi-VN"),inline:false},
            {name:dmSuccess?"📩 Mã backup":"⚠️ Không thể DM",value:dmSuccess?"Đã gửi **mã bí mật 6 ký tự** vào DM của bạn! Kiểm tra tin nhắn riêng.":"Không thể gửi DM! Hãy **mở cho phép nhận DM từ bot** rồi dùng `/backup save` lại.\n\nHoặc xem mã tại `/backup view` trong 5 phút tới."},
          )
          .setDescription("🔒 Mã backup **chỉ gửi qua DM** — không ai khác trong kênh này thấy được!\n💡 Lưu mã lại để dùng `/restore ma:<MÃ>` trong server mới.")
          .setTimestamp();

        // Nếu DM thất bại, tiết lộ mã trong ephemeral (chỉ mình thấy)
        if (!dmSuccess) {
          replyEmbed.addFields({name:"🔑 Mã backup (vì DM thất bại)",value:"# `"+code+"`\n⚠️ Chỉ mình bạn thấy dòng này — lưu lại ngay!"});
        }

        return interaction.editReply({embeds:[replyEmbed]});
      }

      if (action==="view") {
        const code=S.backupCode[gid];
        if (!code||!S.backupStore[code]) return interaction.reply({content:"❌ Server này chưa có backup!\nDùng `/backup save` để tạo backup.",...EP});
        const bk=S.backupStore[code];
        return interaction.reply({embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle("📦 THÔNG TIN BACKUP")
          .addFields(
            {name:"🏠 Server lúc backup",value:bk.guildName,inline:true},
            {name:"📂 Category",value:""+bk.cats.length,inline:true},
            {name:"📁 Kênh",value:""+bk.channels.length,inline:true},
            {name:"👥 Role",value:""+bk.roles.length,inline:true},
            {name:"🕐 Lưu lúc",value:new Date(bk.savedAt).toLocaleString("vi-VN"),inline:false},
            {name:"👤 Lưu bởi",value:bk.savedBy||"Không rõ",inline:true},
            {name:"🔑 Mã backup",value:"**Mã đã được DM khi backup**. Nếu mất mã hãy `/backup save` lại.",inline:false},
            {name:"📝 Kênh (20 đầu)",value:bk.channels.slice(0,20).map(c=>c.name).join(", ")||"Không có"},
          ).setTimestamp()
        ],...EP});
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    //  /restore — nhập MÃ 6 ký tự để khôi phục
    // ══════════════════════════════════════════════════════════════════════
    if (cmd==="restore") {
      const inputCode=interaction.options.getString("ma").trim().toUpperCase();

      // Validate mã
      if (!/^[A-Z0-9]{6}$/.test(inputCode)) {
        return interaction.reply({content:"❌ Mã không hợp lệ! Mã phải là **6 ký tự** gồm chữ và số (VD: `AB3X7K`)",...EP});
      }

      // Tìm backup theo mã
      const bk=S.backupStore[inputCode];
      if (!bk) {
        return interaction.reply({content:"❌ Không tìm thấy backup với mã **`"+inputCode+"`**!\n\n💡 Kiểm tra lại:\n• Mã phải đúng 6 ký tự\n• Mã lấy từ DM khi dùng `/backup save`\n• Mã có phân biệt chữ HOA/thường (bot tự convert HOA)",...EP});
      }

      await interaction.deferReply({});
      const res={roles:0,cats:0,channels:0,errors:[]};
      const catIdMap={};
      const total=bk.roles.length+(bk.cats?.length||0)+bk.channels.length;
      const estMin=Math.ceil(total*0.35/60);

      await interaction.editReply({embeds:[new EmbedBuilder().setColor(0xfee75c).setTitle("♻️ ĐANG KHÔI PHỤC...")
        .setDescription(
          "📌 Mã: **`"+inputCode+"`**\n"+
          "📦 Nguồn: **"+bk.guildName+"** ("+new Date(bk.savedAt).toLocaleString("vi-VN")+")\n"+
          "🎯 Đích: **"+guild.name+"**\n\n"+
          "⏳ Đang tạo **"+bk.roles.length+"** role...\n"+
          "⏳ Đang tạo **"+(bk.cats?.length||0)+"** category...\n"+
          "⏳ Đang tạo **"+bk.channels.length+"** kênh...\n\n"+
          "⏱️ Ước tính: **~"+estMin+" phút** — Vui lòng chờ..."
        )
      ]});

      // BƯỚC 1: Tạo Role
      for (const r of bk.roles) {
        try {
          await guild.roles.create({
            name:r.name, color:r.color||0,
            permissions:BigInt(r.permissions),
            hoist:r.hoist||false, mentionable:r.mentionable||false,
            reason:"Restore backup "+inputCode
          });
          res.roles++;
          await new Promise(ok=>setTimeout(ok,350));
        } catch(e) { res.errors.push("Role \""+r.name+"\": "+e.message.slice(0,60)); }
      }

      // BƯỚC 2: Tạo Category
      for (const cat of (bk.cats||[])) {
        try {
          const nc=await guild.channels.create({
            name:cat.name, type:ChannelType.GuildCategory,
            position:cat.position, reason:"Restore backup "+inputCode
          });
          catIdMap[cat.id]=nc.id;
          res.cats++;
          await new Promise(ok=>setTimeout(ok,350));
        } catch(e) { res.errors.push("Category \""+cat.name+"\": "+e.message.slice(0,60)); }
      }

      // BƯỚC 3: Tạo Kênh
      for (const ch of bk.channels) {
        try {
          const opts={name:ch.name,type:ch.type,position:ch.position,reason:"Restore backup "+inputCode};
          if (ch.parentId&&catIdMap[ch.parentId]) opts.parent=catIdMap[ch.parentId];
          if (ch.type===ChannelType.GuildText) {
            if (ch.topic) opts.topic=ch.topic;
            if (ch.nsfw) opts.nsfw=ch.nsfw;
            if (ch.rateLimitPerUser) opts.rateLimitPerUser=ch.rateLimitPerUser;
          }
          if (ch.type===ChannelType.GuildVoice) {
            if (ch.bitrate) opts.bitrate=Math.min(ch.bitrate,96000);
            if (ch.userLimit) opts.userLimit=ch.userLimit;
          }
          await guild.channels.create(opts);
          res.channels++;
          await new Promise(ok=>setTimeout(ok,350));
        } catch(e) { res.errors.push("Kênh \""+ch.name+"\": "+e.message.slice(0,60)); }
      }

      // Kết quả
      const errText=res.errors.length
        ? res.errors.slice(0,5).join("\n")+(res.errors.length>5?"\n...và "+(res.errors.length-5)+" lỗi khác":"")
        : "✅ Không có lỗi";
      const resultEmbed=new EmbedBuilder()
        .setColor(res.errors.length===0?0x57f287:res.errors.length<5?0xffa500:0xed4245)
        .setTitle("♻️ KHÔI PHỤC HOÀN TẤT!")
        .setDescription("📌 Mã: **`"+inputCode+"`**\n📦 Nguồn: **"+bk.guildName+"** → Đích: **"+guild.name+"**")
        .addFields(
          {name:"✅ Role đã tạo",value:res.roles+"/"+bk.roles.length,inline:true},
          {name:"✅ Category đã tạo",value:res.cats+"/"+(bk.cats?.length||0),inline:true},
          {name:"✅ Kênh đã tạo",value:res.channels+"/"+bk.channels.length,inline:true},
          {name:"⚠️ Lỗi",value:errText},
        ).setTimestamp().setFooter({text:"Kiểm tra lại server sau khi restore!"});

      sendLog(guild,resultEmbed);
      return interaction.editReply({embeds:[resultEmbed]});
    }

    // /exporttemplate
    if (cmd==="exporttemplate") {
      await interaction.deferReply({...EP});
      const cats=guild.channels.cache.filter(c=>c.type===ChannelType.GuildCategory).sort((a,b)=>a.position-b.position);
      const textChs=guild.channels.cache.filter(c=>c.type===ChannelType.GuildText).sort((a,b)=>a.position-b.position);
      const voiceChs=guild.channels.cache.filter(c=>c.type===ChannelType.GuildVoice).sort((a,b)=>a.position-b.position);
      const roles=guild.roles.cache.filter(r=>r.id!==guild.id).sort((a,b)=>b.position-a.position);
      let txt="╔══════════════════════════════════════╗\n";
      txt+="║  TEMPLATE: "+guild.name.slice(0,25).padEnd(25)+" ║\n";
      txt+="║  "+new Date().toLocaleString("vi-VN").slice(0,36).padEnd(36)+" ║\n";
      txt+="╚══════════════════════════════════════╝\n\n";
      txt+=guild.memberCount+" thành viên · "+guild.channels.cache.size+" kênh · "+guild.roles.cache.size+" role\n\n";
      txt+="─".repeat(42)+"\nCẤU TRÚC KÊNH:\n"+"─".repeat(42)+"\n";
      cats.forEach(cat=>{
        txt+="\n📂 ["+cat.name.toUpperCase()+"]\n";
        textChs.filter(c=>c.parentId===cat.id).forEach(c=>{txt+="   💬 #"+c.name+"\n";});
        voiceChs.filter(c=>c.parentId===cat.id).forEach(c=>{txt+="   🔊 "+c.name+"\n";});
      });
      const noCat=textChs.filter(c=>!c.parentId);
      if (noCat.size){txt+="\n📌 [KHÔNG CÓ CATEGORY]\n";noCat.forEach(c=>{txt+="   💬 #"+c.name+"\n";});}
      txt+="\n"+"─".repeat(42)+"\nDANH SÁCH ROLE:\n"+"─".repeat(42)+"\n";
      roles.forEach(r=>{txt+="• "+r.name.padEnd(25)+" "+r.hexColor+"\n";});
      const buf=Buffer.from(txt,"utf-8");
      return interaction.editReply({content:"✅ Template **"+guild.name+"** đã xuất!",files:[{attachment:buf,name:"template_"+guild.name.replace(/[^a-z0-9]/gi,"_")+".txt"}]});
    }

  } catch(err) {
    if (err?.code===10062) return; // Interaction hết hạn
    console.error("Interaction error:", err?.message||err);
    try {
      if (interaction.replied||interaction.deferred) await interaction.followUp({content:"❌ Có lỗi xảy ra!",...EP}).catch(()=>{});
      else await interaction.reply({content:"❌ Có lỗi xảy ra!",...EP}).catch(()=>{});
    } catch {}
  }
});

// ─── GLOBAL ERRORS ────────────────────────────────────────────────────────────
process.on("unhandledRejection",err=>{ if(err?.code===10062)return; console.error("Unhandled:",err?.message||err); });
process.on("uncaughtException",err=>{ console.error("Uncaught:",err?.message||err); });
// Giữ Railway không sleep
const http = require("http");

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running!");
}).listen(process.env.PORT || 3000);
// ─── LOGIN ────────────────────────────────────────────────────────────────────
client.login(TOKEN);
