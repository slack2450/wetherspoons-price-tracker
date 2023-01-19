import { APIGatewayEvent } from 'aws-lambda';

import axios from 'axios';

axios.defaults.baseURL = 'https://static.wsstack.nn4maws.net';

export const handler = async (event: APIGatewayEvent ) => {
    if(!event.pathParameters)
        return;

    const response = await axios.get(`/${event.pathParameters.proxy}`);
    
    return response.data;
}