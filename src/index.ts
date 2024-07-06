/**
 * - Run `npm run dev` in your terminal to start a development server
 * - Run `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"` to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 */
import { DateTime } from 'luxon'

const URL_PREFIX = `https://api.storepoint.co/v1/16026f2c5ac3c7/location/`
const PLAZA_BONITA_ID = 39156327
const FALLBACK_HOUR = 10
const FALLBACK_TIMEOUT = 3 * 60 * 1000
const OPENING_DATE = DateTime.fromISO("2024-06-22T10:00:00.000-07:00") 

interface StorepointResponse {
    success: boolean
    results: any
}

/**
 * Throws an error. Can be used inline with ??
 * @param s string description of the error
 */
function throwError(s: string): never {
    throw new Error(s)
}

/**
 * Calculates the time between now and 10 AM PT (FALLBACK_HOUR).
 * @returns the number of milliseconds between now and 10 AM PT.
 */
function getFallbackTimeout(): number {
    const openingTime = getTodayPT().set({ hour: FALLBACK_HOUR, minute: 0, second: 0, millisecond: 0 })
    return openingTime.diffNow().toObject().milliseconds ?? FALLBACK_TIMEOUT
}

/**
 * Calculates the number of days Round 1 has been open, assuming it has been open every day since June 22, 2024.
 * @returns the number of days Round 1 has been open
 */
function getFallbackDaysOpen(): number {
   return Math.ceil(-(OPENING_DATE.diffNow('days').toObject().days ?? 0)) + 1
}

/**
 * Constructs the Discord message to be sent given the number of days Round 1 will be open for.
 * @param dayNumber the number of days Round 1 will be open for
 * @returns the message to be sent
 */
function getMessage(dayNumber: number): string {
    return `Round1 Plaza Bonita Day ${dayNumber}: START`
}

/**
 * Gets the current DateTime in the Pacific Timezone.
 * @returns the DateTime in PT
 */
function getTodayPT(): DateTime {
    return DateTime.now().setZone("America/Los_Angeles")
}

/**
 * Gets the current day of the week in the Pacific Timezone in lowercase characters.
 * @returns the current day of the week in PT
 */
function getCurrentDayOfWeekPT(): string {
    return getTodayPT().weekdayLong?.toLowerCase() ?? throwError("Internal error: couldn't get the day of week")
}

/**
 * Tries to parse the time string and get the opening time as a DateTime.
 * 
 * Currently, there are 3 formats used on the Round 1 site.
 * - 10AM - 2AM
 * - 10am-2am
 * - 10am to 2am
 * 
 * TODO: Use a LLM to parse the time string.
 * @param hours hours information returned from storepoint
 * @returns the DateTime for the opening time
 */
function getOpeningTime(hours: string): DateTime {
    console.log(`Attempting to parse the opening time from: ${hours}`)
    let times = hours.split('-')
    times = times.length !== 2 ? hours.split('to') : times
    
    const opening = times[0].trim()
    let openingTime = DateTime.fromFormat(opening, 'ha')
    openingTime = !openingTime.isValid ? DateTime.fromFormat(opening, 'h a') : openingTime

    return getTodayPT().set({ hour: openingTime.hour, minute: openingTime.minute, second: openingTime.second, millisecond: openingTime.millisecond })
}

/**
 * Gets the business hours information for the given store ID.
 * @param id the store ID
 * @returns the business hours information as an object
 */
async function getBusinessHours(id: number): Promise<StorepointResponse|undefined> {
    try {
        const url = `${URL_PREFIX}${id}`
        const resp = await fetch(url)
        const data = await resp.json() as StorepointResponse

        if (!resp.ok) throwError(`${resp.status}: could not access ${url}`)
        if (!data.success) throwError(`Unexpected response: ${data}`)

        console.log(`Successfully received a response from storepoint`)
        
        return data
    } catch (err) {
        console.log(err)
    }
}

/**
 * Calculates the time between now to the opening time given the business hours information from storepoint.
 * @param data the StorepointResponse containing the business hours
 * @returns the number of milliseconds between now and the opening time
 */
function getTimeout(data: StorepointResponse): number|undefined {
    try {
        const hours = data.results.location[getCurrentDayOfWeekPT()]
        const openingTime = getOpeningTime(hours)
    
        return openingTime.diffNow().toObject().milliseconds
    } catch (err) {
        console.log(err)
    }
}

/**
 * Sends a Discord message by making a POST request given the webhook ID and webhook token.
 * @param msg the message to send
 * @param webhookId the webhook ID
 * @param webhookToken the webhook token
 */
async function sendDiscordMessage(msg: string, webhookId: string, webhookToken: string): Promise<void> {
    const url = `https://discord.com/api/webhooks/${webhookId}/${webhookToken}`

    const body = {
        content: msg
    }

    const init = {
        body: JSON.stringify(body),
        method: "POST",
        headers: {
            "content-type": "application/json;charset=UTF-8"
        }
    }

    const response = await fetch(url, init)
    console.log(response)
}

export default {
    /**
     * A scheduled job that should be run at 16:57 UTC every day. 
     * The job will send a Discord message when Round 1 opens.
     * 
     * The job first sends a GET request to storepoint, which will return the business hours for Round 1. 
     * If the request is successful, then we try to calculate the amount of time we need to wait before sending the message.
     * If the request is not successful, then we will default to waiting 3 minutes.
     * 
     * We read the number of days for which Round 1 has been open from D1 and construct our message.
     * After sending the message, we update the number of days for which Round 1 has been open in D1.
     * 
     * If we are unable to calculate the time despite a successful response, then we assume Round 1 is closed for the day
     * and do not send a message.
     */
    async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
        const resp: StorepointResponse|undefined = await getBusinessHours(PLAZA_BONITA_ID)
        const timeout: number|undefined = resp !== undefined ? getTimeout(resp) : getFallbackTimeout()
        if (timeout !== undefined) {
            const day: number = await env.DB.prepare('SELECT DaysOpen FROM Stores WHERE StoreId = ?').bind(PLAZA_BONITA_ID).first('DaysOpen') ?? getFallbackDaysOpen()
            const message: string = getMessage(day)
            
            console.log(`Sending the message [${message}] in ${timeout} ms`)
    
            await new Promise(resolve => setTimeout(resolve, timeout));
            await sendDiscordMessage(message, env.WEBHOOK_ID, env.WEBHOOK_TOKEN)
    
            console.log(`Updating database days to ${day + 1}`)
    
            const updateInfo = await env.DB.prepare('UPDATE Stores SET DaysOpen = ?1 WHERE StoreId = ?2').bind(day + 1, PLAZA_BONITA_ID).run()
    
            console.log(updateInfo)
        } else {
            console.log(`Failed to calculate the timeout despite gettting a response from storepoint. Maybe R1 is closed today?\n${resp}`)
        }
    }
} satisfies ExportedHandler<Env>;
