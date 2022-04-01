import mongoose from 'mongoose';
import fetch from 'node-fetch';
import getKrwMarketCodes from './marke_codes.js';
import {Candle} from './model/candle.js';
import {getObv, getObvP10, isNeedToCalcOBV5, isNeedToCalcOBV15, isNeedToCalcOBV240, obvUpdateProcess} from './obv.js';

const codes = await getKrwMarketCodes();

const connUrl = 'mongodb://192.168.219.106:27017/crypto';
mongoose.connect(connUrl);

var db = mongoose.connection;

db.once("open", function() {
  console.log("MongoDB database connection established successfully");
});

const getMinuteCandle = async (code, minuteUnit, lastTime, count) => {
  let collectionName = '';
  switch(minuteUnit){
    case 1: collectionName = 'minute_candles'; break;
    case 15: collectionName = 'minute_candles_15'; break;
    case 240: collectionName = 'minute_candles_240'; break;
  }

  const options = {method: 'GET', headers: {Accept: 'application/json'}};

  try {
    // 1개의 마켓에 대한 캔들 데이터 요청
    let response;
    let tryCount = 0;
    let isFail = false;
    while(true){
      response = await fetch(`https://api.upbit.com/v1/candles/minutes/${minuteUnit}?market=${code}&to=${lastTime}&count=${count}`, options);
      if(response.status === 200){ break; }
      
      if(tryCount++ > 10){
        console.log('업비트 요청한도 초과 - ' + code);
        // 에러로그 기록 혹은 재시도 로직 
        // 실패 시 직전 데이터 카피
        isFail = true;
        break;
      }
    }
    
    let response_json;
    if(isFail){
      response_json = await Candle.aggregate([
        { $match: {market: code}},
          { $unwind: '$data'},
          { $match: {'data.calc_timestamp': {$lt: lastTime}}},
          { $sort: {'data.calc_timestamp': -1}},
          { $limit: 1}
      ])
    }else{
      response_json = await response.json();
    }
    
    
    // Todo. 코드 개선필요
    // 현재 프로세스 응답 데이터 배열을 1. 각각 데이터 존재하는지 조회 하고 2. 각각 삽입 DB 커넥션이 불필요하게 많이 일어 남
    Array.from(response_json).forEach(async (candle) => {
      candle = parseCandle(candle); // 데이터 정규화
      const calcTime = candle.calc_timestamp;
      
      if(isNeedToCalcOBV5(calcTime)){
        candle.obv_5 = await getObv(code, 5, calcTime);
        candle.obv_5_p10 = await getObvP10(code, 5, calcTime);
      }

      if(isNeedToCalcOBV15(calcTime)){
        candle.obv_15 = await getObv(code, 15, calcTime);
        candle.obv_15_p10 = await getObvP10(code, 15, calcTime);
      }

      if(isNeedToCalcOBV240(calcTime)){
        candle.obv_240 = await getObv(code, 240, calcTime);
        candle.obv_240_p10 = await getObvP10(code, 240, calcTime);
      }
      
      await db.collection(collectionName).find({"market": code, "data": {"$elemMatch":{"calc_timestamp": candle.calc_timestamp}}}).count().then(async (cnt) => {
        if(cnt === 0){ // 해당 시간의 데이터가 존재하지 않으면 데이터 삽입
          await db.collection(collectionName).findOneAndUpdate({"market": code}, {$push: {data: candle}}, {upsert:true});
        }
      });
    })
  } catch (error) {
    console.error('[' + code + '] ' + error); 
    // 재요청 
  }
}

const parseCandle = (candleData) => {
  candleData.calc_timestamp = parseTimestampToMinuteUnit(candleData.timestamp);
  
  candleData.obv_5 = 0;
  candleData.obv_5_p10 = 0;
  candleData.obv_15 = 0;
  candleData.obv_15_p10 = 0;
  candleData.obv_240 = 0;
  candleData.obv_240_p10 = 0;

  return candleData;
}

const parseTimestampToMinuteUnit = (timestamp) => {
  let secUnit = Math.floor(timestamp / 1000);
  let minuteUnit = secUnit - (secUnit % 60);
  return minuteUnit;
}

const getCurrMinuteCandle = () => { // 1분마다 캔들 데이터 조회
  setInterval(()=>{
    const currTime = new Date().toISOString();
    executeMinuteCandle(currTime, codes, 1, 200);
  }, 1000 * 30);
}

// 기준시에서 1시간씩 증가시키며 캔들 데이터 조회 
const getPrevMinuteCandle = (criTime) => {
  console.log('start getPrevMinuteCandle');
  const hour = 1000 * 60 * 60;
  criTime = criTime - (criTime % (hour));
  let seq = 0;

  setInterval(()=>{
    const time = new Date(criTime + (hour * seq++)).toISOString();
    executeMinuteCandle(time, codes, 1, 100);
    console.log('ing getPrevMinuteCandle / ', time);
  }, 1000 * 1);
  
  console.log('end getPrevMinuteCandle');
}

async function executeMinuteCandle(currTime, codes, timeUnit, count) {
  let i = 0;
  let len = codes.length;

  while (true) {
    await new Promise(resolve => setTimeout(resolve, 400));

    const code = codes[i++];
    // console.log(code);
    getMinuteCandle(code, timeUnit, currTime, count);
    
    if(i >= len) break;
  }
}



// getCurrMinuteCandle();
let prevTime = 1648573200000; // 2022-03-30 02:00
// getPrevMinuteCandle(prevTime);
// obvUpdateProcess(1648566300);

let a = 1648569600 * 1000;
getPrevMinuteCandle(a);


