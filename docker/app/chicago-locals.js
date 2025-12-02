// Chicago DMA 602 local channel configuration
// Discovered from iOS app traffic analysis (Apple_APP_Raw_12-01-2025-10-02-35.folder)

const CHICAGO_CLIENT_CONTEXT = 'dmaID:602_0,billingDmaID:602,regionID:OV Chicago IL 602_OV MeTV Allowed SPOT,zipCode:60804,countyCode:031,stateNumber:17,stateAbbr:IL';

// Chicago local channels discovered from iOS app traffic
// Stream URL format: channel(CALLSIGN-CCID.dfw.RESOLUTION)
const CHICAGO_LOCALS = [
  {
    callSign: 'WBBM',
    ccid: '8631',
    channelNumber: '02',
    channelName: 'WBBM CBS Chicago',
    networkAffiliation: 'CBS',
    replacesNY: ['WCBS', 'WCBS-TV']
  },
  {
    callSign: 'WMAQ',
    ccid: '8632',
    channelNumber: '05',
    channelName: 'WMAQ NBC Chicago',
    networkAffiliation: 'NBC',
    replacesNY: ['WNBC', 'WNBC-TV']
  },
  {
    callSign: 'WLS',
    ccid: '8633',
    channelNumber: '07',
    channelName: 'WLS ABC Chicago',
    networkAffiliation: 'ABC',
    replacesNY: ['WABC', 'WABC-TV']
  },
  {
    callSign: 'WFLD',
    ccid: '8634',
    channelNumber: '32',
    channelName: 'WFLD FOX Chicago',
    networkAffiliation: 'FOX',
    replacesNY: ['WNYW', 'WNYW-TV', 'FOX 5']
  }
];

module.exports = { CHICAGO_CLIENT_CONTEXT, CHICAGO_LOCALS };
