
import Datastore from 'nedb'
import path from 'path'

// datastore for plain impressions
// datastore for channel state

export const impressionDB = new Datastore({ filename: path.join(__dirname, '/DATA_IMPRESSION'), autoload: true })
export const channelDB = new Datastore({ filename: path.join(__dirname, '/DATA_CHANNEL'), autoload: true })

export const supImpDB = new Datastore({ filename: path.join(__dirname, '/S_DATA_IMPRESSION'), autoload: true })
export const supChDB = new Datastore({ filename: path.join(__dirname, '/S_DATA_CHANNEL'), autoload: true })

export const amImpDB = new Datastore({ filename: path.join(__dirname, '/A_DATA_IMPRESSION'), autoload: true })
export const amChDB = new Datastore({ filename: path.join(__dirname, '/A_DATA_CHANNEL'), autoload: true })
