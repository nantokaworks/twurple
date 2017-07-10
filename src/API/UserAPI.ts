import { Cacheable, Cached, CacheEntry } from '../Toolkit/Decorators';
import BaseAPI from './BaseAPI';
import PrivilegedUser from './PrivilegedUser';
import User, { UserData } from './User';
import ObjectTools, { UniformObject } from '../Toolkit/ObjectTools';
import { UserIdResolvable, default as UserTools } from '../Toolkit/UserTools';
import EmoteSetList from './EmoteSetList';
import UserSubscription from './UserSubscription';

@Cacheable
export default class UserAPI extends BaseAPI {
	private _userByNameCache: Map<string, CacheEntry<User>> = new Map;

	@Cached(3600)
	async getCurrentUser() {
		return new PrivilegedUser(await this._client.apiCall({url: 'user', scope: 'user_read'}), this._client);
	}

	@Cached(3600)
	async getUserById(userId: string) {
		return new User(await this._client.apiCall({url: `users/${userId}`}), this._client);
	}

	// not using the decorator's cache here as users-by-name is slightly more complex to cache
	async getUserByName(userName: string): Promise<User> {
		this._cleanUserCache();
		if (this._userByNameCache.has(userName)) {
			return (this._userByNameCache.get(userName) as CacheEntry<User>).value;
		}
		const {users} = await this._client.apiCall({url: 'users', query: {login: userName}});
		if (users.length === 0) {
			throw new Error('user not found');
		}
		const user = new User(users[0], this._client);
		this._userByNameCache.set(userName, {
			value: user,
			expires: Date.now() + 3600 * 1000
		});
		return user;
	}

	async getUsersByNames(userNames: string[]): Promise<UniformObject<User>> {
		this._cleanUserCache();
		userNames = userNames.map(name => name.toLowerCase());
		const cachedEntries = Array.from(this._userByNameCache.entries()).filter(([key, val]) => userNames.includes(key));
		const cachedObject = ObjectTools.entriesToObject(cachedEntries);
		const cachedUsers = ObjectTools.map<CacheEntry<User>, User>(cachedObject, entry => entry.value);
		const toFetch = userNames.filter(name => !(name in cachedUsers));
		if (!toFetch.length) {
			return cachedUsers;
		}
		const usersData = await this._client.apiCall({url: 'users', query: {login: toFetch.join(',')}});
		const usersArr: User[] = usersData.users.map((data: UserData) => new User(data, this._client));
		Object.values(usersArr).forEach(user => this._userByNameCache.set(user.userName, user));
		const users = ObjectTools.indexBy(usersArr, 'userName');

		return {...cachedUsers, ...users};
	}

	@Cached(3600)
	async getUserEmotes(user?: UserIdResolvable) {
		let userId: string;
		if (user) {
			userId = UserTools.getUserId(user);
		} else {
			const tokenInfo = await this._client.getTokenInfo();
			if (!tokenInfo.valid) {
				throw new Error('authorization necessary to get emotes');
			}
			userId = tokenInfo.userId as string;
		}

		const data = await this._client.apiCall({url: `users/${userId}/emotes`, scope: 'user_subscriptions'});
		return new EmoteSetList(data.emoticon_sets, this._client);
	}

	@Cached(3600)
	async getSubscriptionData(user: UserIdResolvable, toChannel: UserIdResolvable) {
		const userId = UserTools.getUserId(user);
		const channelId = UserTools.getUserId(toChannel);

		return new UserSubscription(
			await this._client.apiCall({
				url: `users/${userId}/subscriptions/${channelId}`,
				scope: 'user_subscriptions'
			}),
			this._client
		);
	}

	private _cleanUserCache() {
		const now = Date.now();
		this._userByNameCache.forEach((val, key) => {
			if (val.expires < now) {
				this._userByNameCache.delete(key);
			}
		});
	}
}
