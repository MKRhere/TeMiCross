import R from 'ramda';
import Telegraf, { Context } from 'telegraf';

import Client from '../client/run';
import Parser from '../client/parser';

import { messageJSON, textJSON } from '../client/generator';

import { code, escape, logError } from './utils';

import emitUpdates from './gameVersionCheck';

const tgOpts = { parse_mode: 'HTML' };

const splitSpace = R.split(' ');
const joinSpace = R.join(' ');

const prop = <Prop extends string>(p: Prop) => <V>(
	o: Partial<Record<Prop, V>>,
): V | undefined => o[p];
const join = (...xs: string[]) => xs.join(' ');

const id = R.prop('id');
const chat = R.prop('chat');
const from = R.prop('from');
const text = R.prop('text');
const message = R.prop('message');
const lastName = R.prop('last_name');
const firstName = R.prop('first_name');
const reply = R.prop('reply_to_message');

const chatID = (o: Context) => o.chat?.id;
const fromID = (o: Context) => o.from?.id;

const fromName = ({ from }: Context) =>
	from?.last_name ? join(from?.first_name, from?.last_name) : from?.first_name;

const minecraftUsername = R.o(R.head, splitSpace);

const removeMinecraftUsername = R.compose(joinSpace, R.tail, splitSpace);

const nextArg = R.nthArg(1);

const captionMedia = (name, fn) =>
	R.ifElse(
		R.compose(R.prop('caption'), fn),
		R.compose(
			R.insert(3, R.__, [
				{ text: '[', color: 'white' },
				{ text: name, color: 'gray' },
				{ text: '] ', color: 'white' },
			]),
			textJSON,
			R.compose(R.prop('caption'), fn),
		),
		R.always([
			{ text: '[', color: 'white' },
			{ text: name, color: 'gray' },
			{ text: ']', color: 'white' },
		]),
	);

const run = opts => {
	const { token, chatID: tgID, allowList, localAuth } = opts;

	const botID = R.head(R.split(':', token));

	const client = Client({ ...opts, interactive: false });

	const servertype = Parser.fixType(opts.servertype);

	if (servertype === 'default') {
		client.on('vjoin', data => client.emit('join', data));
	}

	const bot = new Telegraf(token);
	bot.options.id = botID;

	client.on('close', () => bot.stop());
	bot.telegram.getMe().then(info => Object.assign(bot.options, info));

	const send = msg => bot.telegram.sendMessage(tgID, msg, tgOpts);

	if (opts.postUpdates) {
		const updates = emitUpdates();
		updates.on('update', version =>
			send('<b>New version released:</b> ' + code(version)),
		);
		client.on('close', () => updates.stop());
	}

	let maxPlayers = 0;
	const players = [];

	if (localAuth) {
		// eslint-disable-next-line global-require
		require('./auth')(bot, client);
	}

	const addPlayer = name => {
		players.splice(0, Infinity, ...players.filter(x => x !== name), name);
		return name;
	};
	const removePlayer = name => {
		players.splice(0, Infinity, ...players.filter(x => x !== name));
		return name;
	};

	if (allowList) {
		new Promise((resolve, reject) => {
			setTimeout(() => reject(new Error('/list took too long!')), 300000);
			return client.once('players_count', count =>
				resolve([
					count.current,
					count.max,
					count.players.split(/\s*,\s*/).filter(l => l.length > 0),
				]),
			);
		}).then(([, max, ps]) => {
			maxPlayers = max;
			players.splice(0, Infinity, ...ps);
		});
	}

	client.send('list');

	client.on('user', msg => send(code(msg.user) + ' ' + escape(msg.text)));

	client.on('self', msg => send(code('* ' + msg.user + ' ' + msg.text)));

	client.on('say', msg => send(code(msg.user + ': ' + msg.text)));

	client.on('join', msg =>
		send(code(addPlayer(msg.user) + ' joined the server')),
	);

	client.on('leave', msg =>
		send(code(removePlayer(msg.user) + ' left the server')),
	);

	client.on('death', msg => send(code(msg.user + ' ' + msg.text)));

	client.on('advancement', msg =>
		send(
			code(msg.user) +
				' has made the advancement ' +
				code('[' + msg.advancement + ']'),
		),
	);

	client.on('goal', msg =>
		send(
			code(msg.user) + ' has reached the goal ' + code('[' + msg.goal + ']'),
		),
	);

	client.on('challenge', msg =>
		send(
			code(msg.user) +
				' has completed the challenge ' +
				code('[' + msg.challenge + ']'),
		),
	);

	client.on('close', () => bot.stop());

	bot.command('chatid', ctx => ctx.reply(ctx.chat.id));

	if (allowList) {
		bot.command('list', ctx =>
			ctx.reply(
				'Players online ' +
					'(' +
					code(players.length) +
					'/' +
					code(maxPlayers) +
					'):\n' +
					code(players.join('\n')),
				tgOpts,
			),
		);
	}

	const telegram = R.compose(R.not, R.equals(botID), String, fromID);

	const fromUser = R.ifElse(
		telegram,
		R.o(fromName, message),
		R.compose(minecraftUsername, text, message),
	);

	const handler = R.ifElse(
		R.compose(
			x => players.length > 0 && x,
			R.equals(tgID),
			String,
			chatID,
			message,
		),
		R.compose(
			R.bind(client.send, client),
			R.concat('tellraw @a '),
			JSON.stringify,
			R.converge(messageJSON, [
				// telegram
				R.o(telegram, message),
				// from
				fromUser,
				// text
				R.cond([
					[R.compose(text, message), R.compose(text, message)],
					[R.compose(R.prop('audio'), message), captionMedia('AUDIO', message)],
					[
						R.compose(R.prop('document'), message),
						captionMedia('DOCUMENT', message),
					],
					[R.compose(R.prop('photo'), message), captionMedia('IMAGE', message)],
					[
						R.compose(R.prop('sticker'), message),
						captionMedia('STICKER', message),
					],
					[R.compose(R.prop('video'), message), captionMedia('VIDEO', message)],
					[R.compose(R.prop('voice'), message), captionMedia('VOICE', message)],
					[
						R.compose(R.prop('contact'), message),
						captionMedia('CONTACT', message),
					],
					[
						R.compose(R.prop('location'), message),
						captionMedia('LOCATION', message),
					],
					[R.compose(R.prop('game'), message), captionMedia('GAME', message)],
					[
						R.compose(R.prop('video_note'), message),
						captionMedia('VIDEO NOTE', message),
					],
				]),
				// hoverType
				R.ifElse(R.o(reply, message), R.always('Reply'), R.always(undefined)),
				// hoverUserTelegram
				R.compose(telegram, reply, message),
				// hoverUser
				R.ifElse(
					R.o(reply, message),
					R.ifElse(
						R.compose(R.equals(botID), String, fromID, reply, message),
						R.compose(minecraftUsername, text, reply, message),
						R.compose(fromName, reply, message),
					),
					R.always(undefined),
				),
				// hoverText
				R.ifElse(
					R.compose(telegram, reply, message),
					R.cond([
						[R.compose(text, reply, message), R.compose(text, reply, message)],
						[
							R.compose(R.prop('audio'), reply, message),
							captionMedia('AUDIO', R.compose(reply, message)),
						],
						[
							R.compose(R.prop('document'), reply, message),
							captionMedia('DOCUMENT', R.compose(reply, message)),
						],
						[
							R.compose(R.prop('photo'), reply, message),
							captionMedia('IMAGE', R.compose(reply, message)),
						],
						[
							R.compose(R.prop('sticker'), reply, message),
							captionMedia('STICKER', R.compose(reply, message)),
						],
						[
							R.compose(R.prop('video'), reply, message),
							captionMedia('VIDEO', R.compose(reply, message)),
						],
						[
							R.compose(R.prop('voice'), reply, message),
							captionMedia('VOICE', R.compose(reply, message)),
						],
						[
							R.compose(R.prop('contact'), reply, message),
							captionMedia('CONTACT', R.compose(reply, message)),
						],
						[
							R.compose(R.prop('location'), reply, message),
							captionMedia('LOCATION', R.compose(reply, message)),
						],
						[
							R.compose(R.prop('game'), reply, message),
							captionMedia('GAME', R.compose(reply, message)),
						],
						[
							R.compose(R.prop('video_note'), reply, message),
							captionMedia('VIDEO NOTE', R.compose(reply, message)),
						],
					]),
					R.compose(removeMinecraftUsername, text, reply, message),
				),
			]),
		),
		R.o(R.call, nextArg),
	);

	bot.on(
		[
			'text',
			'audio',
			'document',
			'photo',
			'sticker',
			'video',
			'voice',
			'contact',
			'location',
			'game',
			'video_note',
		],
		handler,
	);

	bot.catch(logError);

	bot.launch(opts.telegraf);

	return bot;
};

export default run;
