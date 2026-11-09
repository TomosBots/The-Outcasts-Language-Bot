require("dotenv").config();

const {
  Client, Events, GatewayIntentBits, SlashCommandBuilder, REST, Routes,
  ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, StringSelectMenuBuilder
} = require("discord.js");

const GUILD_ID = process.env.GUILD_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const LIBRETRANSLATE_URL = (process.env.LIBRETRANSLATE_URL || "").replace(/\/+$/, "");
const LIBRETRANSLATE_API_KEY = process.env.LIBRETRANSLATE_API_KEY || "";

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing DISCORD_TOKEN, CLIENT_ID or GUILD_ID in Railway variables.");
  process.exit(1);
}

const CATEGORY_NAME = "🌍 LANGUAGE ANNOUNCEMENTS";
const PANEL_CHANNEL_NAME = "choose-your-language";
const PANEL_BUTTON_ID = "outcasts_language_open";
const LANGUAGE_MENU_ID = "outcasts_language_select";

const LANGUAGES = [
  { code: "en", name: "English", flag: "🇬🇧", channel: "announcements-english" },
  { code: "ar", name: "Arabic", flag: "🇸🇦", channel: "announcements-arabic" },
  { code: "ru", name: "Russian", flag: "🇷🇺", channel: "announcements-russian" },
  { code: "it", name: "Italian", flag: "🇮🇹", channel: "announcements-italian" },
  { code: "tr", name: "Turkish", flag: "🇹🇷", channel: "announcements-turkish" },
  { code: "es", name: "Spanish", flag: "🇪🇸", channel: "announcements-spanish" },
  { code: "fr", name: "French", flag: "🇫🇷", channel: "announcements-french" },
  { code: "de", name: "German", flag: "🇩🇪", channel: "announcements-german" },
  { code: "pt", name: "Portuguese", flag: "🇵🇹", channel: "announcements-portuguese" },
  { code: "pl", name: "Polish", flag: "🇵🇱", channel: "announcements-polish" }
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const roleName = language => `Language • ${language.name}`;

function panelPayload() {
  const embed = new EmbedBuilder()
    .setColor(0xD4AF37)
    .setTitle("🌍 THE OUTCASTS | LANGUAGE SELECTION")
    .setDescription(
      "Choose the language you want to receive announcements in.\n\n" +
      "You will only be able to see the announcement channel for your selected language. " +
      "You can change your selection at any time."
    )
    .setFooter({ text: "THE OUTCASTS • OLYMPUS COMMUNITY" });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(PANEL_BUTTON_ID).setLabel("Choose Your Language")
      .setEmoji("🌍").setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

function languageMenuRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(LANGUAGE_MENU_ID)
    .setPlaceholder("Select your preferred language")
    .setMinValues(1).setMaxValues(1)
    .addOptions(LANGUAGES.map(language => ({
      label: language.name,
      value: language.code,
      emoji: language.flag,
      description: `Receive announcements in ${language.name}`
    })));
  return new ActionRowBuilder().addComponents(menu);
}

async function findOrCreateRole(guild, language) {
  let role = guild.roles.cache.find(item => item.name === roleName(language));
  if (!role) {
    role = await guild.roles.create({
      name: roleName(language), mentionable: false, hoist: false,
      reason: "The Outcasts language selection system"
    });
  }
  return role;
}

async function findOrCreateCategory(guild, botMember) {
  let category = guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildCategory && channel.name === CATEGORY_NAME
  );
  if (!category) {
    category = await guild.channels.create({
      name: CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel] },
        { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] }
      ],
      reason: "The Outcasts language announcement system"
    });
  }
  return category;
}

function staffOverwrites(guild) {
  return [...guild.roles.cache.values()]
    .filter(role => role.id !== guild.roles.everyone.id &&
      (role.permissions.has(PermissionFlagsBits.Administrator) ||
       role.permissions.has(PermissionFlagsBits.ManageGuild)))
    .map(role => ({
      id: role.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
    }));
}

async function findOrCreateTextChannel(guild, name, category, overwrites) {
  let channel = guild.channels.cache.find(item =>
    item.type === ChannelType.GuildText && item.name === name
  );
  if (!channel) {
    channel = await guild.channels.create({
      name, type: ChannelType.GuildText, parent: category.id,
      permissionOverwrites: overwrites,
      reason: "The Outcasts language announcement system"
    });
  } else {
    await channel.permissionOverwrites.set(overwrites);
    if (channel.parentId !== category.id) await channel.setParent(category.id);
  }
  return channel;
}

async function setupLanguages(guild) {
  const botMember = await guild.members.fetchMe();
  const needed = [
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks
  ];
  if (needed.some(permission => !botMember.permissions.has(permission))) {
    throw new Error("Give the bot Manage Roles, Manage Channels, View Channel, Send Messages and Embed Links permissions.");
  }

  const category = await findOrCreateCategory(guild, botMember);
  const staff = staffOverwrites(guild);
  const panelOverwrites = [
    { id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages] },
    { id: botMember.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] },
    ...staff
  ];
  const panel = await findOrCreateTextChannel(guild, PANEL_CHANNEL_NAME, category, panelOverwrites);

  const recent = await panel.messages.fetch({ limit: 30 });
  const oldPanel = recent.find(message => message.author.id === client.user.id &&
    message.components.some(row => row.components.some(component => component.customId === PANEL_BUTTON_ID)));
  if (oldPanel) await oldPanel.edit(panelPayload());
  else await panel.send(panelPayload());

  for (const language of LANGUAGES) {
    const role = await findOrCreateRole(guild, language);
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
      { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] },
      ...staff
    ];
    await findOrCreateTextChannel(guild, language.channel, category, overwrites);
  }
  return panel;
}

async function translateText(text, target) {
  if (!LIBRETRANSLATE_URL) throw new Error("Set LIBRETRANSLATE_URL in Railway variables.");
  const payload = { q: text, source: "en", target, format: "text" };
  if (LIBRETRANSLATE_API_KEY) payload.api_key = LIBRETRANSLATE_API_KEY;
  const response = await fetch(`${LIBRETRANSLATE_URL}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`LibreTranslate HTTP ${response.status}: ${details.slice(0, 250)}`);
  }
  const result = await response.json();
  if (!result.translatedText) throw new Error("LibreTranslate returned no translated text.");
  return result.translatedText;
}

async function publishAnnouncement(guild, originalText) {
  await guild.channels.fetch();
  const results = [];
  for (const language of LANGUAGES) {
    try {
      const channel = guild.channels.cache.find(item =>
        item.type === ChannelType.GuildText && item.name === language.channel
      );
      if (!channel) throw new Error(`Missing #${language.channel}; run /setup-languages first.`);
      const translated = language.code === "en"
        ? originalText
        : await translateText(originalText, language.code);
      const embed = new EmbedBuilder()
        .setColor(0xD4AF37)
        .setTitle(`${language.flag} THE OUTCASTS | ANNOUNCEMENT`)
        .setDescription(translated.length > 4096 ? `${translated.slice(0, 4090)}…` : translated)
        .setFooter({ text: `THE OUTCASTS • ${language.name.toUpperCase()}` })
        .setTimestamp();
      await channel.send({ embeds: [embed] });
      results.push({ name: language.name, ok: true });
      console.log(`Announcement posted in ${language.channel}`);
    } catch (error) {
      console.error(`Announcement failed for ${language.name}:`, error.message);
      results.push({ name: language.name, ok: false });
    }
  }
  return results;
}

const commands = [
  new SlashCommandBuilder()
    .setName("setup-languages")
    .setDescription("Create the language roles, private channels and selection panel"),
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Translate and publish an announcement to all language channels")
    .addStringOption(option => option.setName("message")
      .setDescription("Write the announcement in English")
      .setRequired(true).setMaxLength(3500))
].map(command => command.toJSON());

client.once(Events.ClientReady, async readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  try {
    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("Registered /setup-languages and /announce.");
  } catch (error) {
    console.error("Slash-command registration failed:", error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!interaction.inGuild()) {
        return interaction.reply({ content: "Use this command inside The Outcasts.", ephemeral: true });
      }
      const isStaff = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
      if (!isStaff) {
        return interaction.reply({ content: "You need Manage Server permission to use this command.", ephemeral: true });
      }

      if (interaction.commandName === "setup-languages") {
        await interaction.deferReply({ ephemeral: true });
        const panel = await setupLanguages(interaction.guild);
        return interaction.editReply(`✅ Language system created. Members can choose their language in <#${panel.id}>.`);
      }

      if (interaction.commandName === "announce") {
        const message = interaction.options.getString("message", true).trim();
        if (!message) return interaction.reply({ content: "Please enter an announcement.", ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        const results = await publishAnnouncement(interaction.guild, message);
        const posted = results.filter(item => item.ok).length;
        const failed = results.filter(item => !item.ok).map(item => item.name);
        let reply = `📢 Announcement delivery finished: **${posted}/${LANGUAGES.length}** languages posted.`;
        if (failed.length) reply += `\n⚠️ Could not post: ${failed.join(", ")}. Check Railway logs and LibreTranslate settings.`;
        return interaction.editReply(reply);
      }
    }

    if (interaction.isButton() && interaction.customId === PANEL_BUTTON_ID) {
      return interaction.reply({
        content: "🌍 **Choose your preferred announcement language:**",
        components: [languageMenuRow()],
        ephemeral: true
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === LANGUAGE_MENU_ID) {
      if (!interaction.inGuild()) {
        return interaction.reply({ content: "Please select your language inside The Outcasts.", ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      const chosen = LANGUAGES.find(language => language.code === interaction.values[0]);
      if (!chosen) return interaction.editReply("That language selection is not valid.");

      const guild = interaction.guild;
      const member = await guild.members.fetch(interaction.user.id);
      const allLanguageRoles = LANGUAGES.map(language =>
        guild.roles.cache.find(role => role.name === roleName(language))
      ).filter(Boolean);
      const selectedRole = allLanguageRoles.find(role => role.name === roleName(chosen));
      if (!selectedRole) {
        return interaction.editReply("The language system has not been set up yet. Please ask an admin to run `/setup-languages`.");
      }

      const rolesToRemove = allLanguageRoles.filter(role =>
        role.id !== selectedRole.id && member.roles.cache.has(role.id)
      );
      if (rolesToRemove.length) await member.roles.remove(rolesToRemove, "Member changed announcement language");
      if (!member.roles.cache.has(selectedRole.id)) {
        await member.roles.add(selectedRole, "Member selected announcement language");
      }

      const channel = guild.channels.cache.find(item => item.name === chosen.channel);
      return interaction.editReply(
        `✅ Your language is now **${chosen.flag} ${chosen.name}**.` +
        (channel ? ` You can access <#${channel.id}>.` : "")
      );
    }
  } catch (error) {
    console.error("Interaction error:", error);
    const message = "Something went wrong. Check the bot's permissions and Railway logs.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

client.login(DISCORD_TOKEN);
