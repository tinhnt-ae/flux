import Conf from 'conf';

export type ConfigKey = keyof FluxConfig;

export type FluxConfig = {
  apiKey?: string;
  llmModel?: string;
  searxngUrl?: string;
};

export type ConfigStore = {
  get<Key extends ConfigKey>(key: Key): FluxConfig[Key];
  set<Key extends ConfigKey>(key: Key, value: NonNullable<FluxConfig[Key]>): void;
};

let conf: Conf<FluxConfig> | undefined;

function getConf(): Conf<FluxConfig> {
  conf ??= new Conf<FluxConfig>({ projectName: 'flux-cli' });
  return conf;
}

const store: ConfigStore = {
  get(key) {
    return getConf().get(key);
  },
  set(key, value) {
    getConf().set(key, value);
  }
};

export default store;
