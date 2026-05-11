# PCs órfãos — existem no SmartSuite mas não no Omie SF

> Gerado em 2026-04-22 via dry-run. **Não importar** esses 187 PCs — não há correspondência em `orders.pedidos_compra` (empresa=SF).
>
> Possíveis causas:
> - Lixo/teste: `12345`, `1306251515`, `1606251400` (parecem timestamps digitados errado)
> - PCs cancelados no Omie que permaneceram no Smart
> - Erros de entrada no Smart (typo no PC.Numero)

## Lista completa (187 PCs)

```
12345         1306251515    1606251400    4522          4760
4791          4796          4840          4847          4851
4866          4881          4908          4909          4912
4913          4918          4926          4937          4938
4955          4974          5009          5012          5028
5033          5040          5042          5046          5047
5050          5068          5075          5079          5099
5131          5133          5143          5170          5181
5183          5192          5193          5222          5225
5226          5227          5228          5260          5263
5271          5278          5280          5285          5326
5336          5347          5348          5361          5363
5385          5387          5388          5389          5390
5391          5399          5417          5427          5429
5440          5444          5453          5458          5468
5470          5478          5502          5503          5507
5532          5549          5556          5557          5559
5560          5562          5569          5578          5586
5594          5600          5634          5638          5642
5647          5648          5649          5650          5651
5657          5658          5664          5665          5672
5700          5715          5719          5720          5733
5737          5760          5770          5777          5786
5806          5815          5829          5847          5853
5860          5888          5896          5906          5913
5916          5940          5944          5954          5967
5973          5974          5982          5992          5998
6006          6008          6037          6041          6070
6098          6100          6111          6123          6131
6135          6136          6137          6138          6154
6155          6159          6178          6201          6203
6212          6216          6225          6245          6255
6260          6268          6274          6280          6303
6316          6335          6339          6342          6353
6379          6389          6390          6396          6405
6447          6452          6476          6525          6575
6576          6577          6578          6579          6580
6586          6587
```

Versão machine-readable: `/tmp/smartsuite_snapshot/orphans.json`

## Origem dos dados

- Smart unique `PC.Numero`: 1.528 (pós-dedup das 8 colisões apagadas em 2026-04-22)
- Matched em `orders.pedidos_compra` WHERE empresa='SF': 1.341
- Órfãos: 187 (12%)
